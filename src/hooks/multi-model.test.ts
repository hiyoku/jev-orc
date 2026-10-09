import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'
import { loadConfig } from '../config'
import { decide } from '../domain/policy'
import type { JevAnswers } from '../jev/answers'
import { LOG_PATH } from '../log'

const MULTI = { multiModel: true, maxModelsPerTask: 2 }
const answers = (score: number, confidence: number): JevAnswers => ({
  complexity: { score, confidence },
  deliberation: { noul: 0.1 },
  edits_files: { noul: 0 }, runs_shell: { noul: 0 }, web_research: { noul: 0 },
  library_docs: { noul: 0 }, browser: { noul: 0 },
})
// Opus-tier complexity with low confidence: the case that justifies a verifier.
const HARD = answers(2.8, 0.3)
const modelsOf = (a: JevAnswers, options = {}) => {
  const d = decide(a, loadConfig(options).config)
  if ('skip' in d) throw new Error(d.skip)
  return d
}

// Policy

test('multiModel is off by default: one model', () => {
  expect(modelsOf(HARD).models).toEqual(['opus'])
})

test('on without justification: one model', () => {
  expect(modelsOf(answers(2.8, 0.9), MULTI).models).toEqual(['opus'])
  expect(modelsOf(answers(1.5, 0.3), MULTI).models).toEqual(['opus'])
  expect(modelsOf(answers(1.5, 0.45), MULTI).models).toEqual(['sonnet'])
})

test('on with justification: the strongest other enabled model verifies', () => {
  const d = modelsOf(HARD, MULTI)
  expect(d.models).toEqual(['opus', 'sonnet'])
  expect(d.reasons.some((r) => r.startsWith('verifier sonnet:'))).toBe(true)
  expect(modelsOf(HARD, { ...MULTI, effortsOpus: [] }).models).toEqual(['sonnet', 'haiku'])
  expect(modelsOf(HARD, { ...MULTI, effortsOpus: [], effortsSonnet: [] }).models).toEqual(['haiku'])
})

test('maxModelsPerTask 1 wins; a forced model has no verifier', () => {
  expect(modelsOf(HARD, { ...MULTI, maxModelsPerTask: 1 }).models).toEqual(['opus'])
  expect(modelsOf(HARD, { ...MULTI, forceModel: 'opus' }).models).toEqual(['opus'])
})

// Runtime

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
const done = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

// The test's hooks stand for the engine: registration, the Agent tool, the JEV endpoint, toasts.
async function world($: Engine, on: On) {
  const spawns: AgentSpawnInput[] = []
  const toasts: string[] = []
  let jevCalls = 0
  const files = new Map<string, string>()
  mock.env(on, { HOME: '/home/u', TYPESAFE_API_KEY: 'sk-test' })
  mock.clock(on)
  on('session.start', (_, e) => e)
  on('agent.register', (_, spec) => ({ value: { agent: `jev-orchestrator:${spec.name}` } }))
  on('agent.offer', () => ({ isOffered: true }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path)! }))
  on('fs.write', (_, e) => (files.set(e.path, e.text), { value: undefined }))
  on('http.fetch', () => (jevCalls++, { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: HARD }) } }))
  on('tool.call', async (_, e) => {
    const a = e as unknown as { tool_use_id: string; prompt: string; description: string }
    const spawned = await $.agent.spawn({
      tool_use_id: a.tool_use_id, prompt: a.prompt, description: a.description, subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-haiku-5-5', background: true, fork: false,
    })
    return { result: spawned as never }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', async (_, e) => {
    const offered = await $.agent.offer({ agent: e.subagentType, description: '', source: 'plugin', provider: e.provider })
    if (!offered.isOffered) throw new Error(`not offered: ${e.subagentType}`)
    spawns.push(e)
    return { model: e.model ?? 'inherit', agentId: `a${spawns.length}` }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  const call = (id: string) =>
    $.tool.call({ tool: 'Agent', tool_use_id: id, description: 'audit auth', prompt: 'audit the auth flow', subagent_type: 'general-purpose' } as never)
  const logLines = () => (files.get(`/home/u/${LOG_PATH}`) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { spawns, toasts, call, jevCalls: () => jevCalls, logLines }
}

test('the verifier is spawned once after the primary completes, and never routed', { options: MULTI }, async ($, on) => {
  const w = await world($, on)
  await w.call('p1')
expect(w.spawns.map((s) => s.model)).toEqual(['opus'])

  await $.turn.complete({ ...done, agentId: 'a1', answer: 'primary says ok' })
  await tick()
  expect(w.spawns).toHaveLength(2)
  // The kit hands a plugin's own spawn on in the Agent tool's shape (subagent_type), as spike H6 saw.
  const verifier = w.spawns[1] as AgentSpawnInput & { subagent_type?: string }
  expect(verifier.model).toBe('sonnet')
  expect(verifier.subagentType ?? verifier.subagent_type).toBe('jev-orchestrator:t-read')
  expect(verifier.description).toBe('verify: audit auth')
  expect(verifier.prompt).toContain('audit the auth flow')
  expect(verifier.prompt).toContain('primary says ok')
  expect(w.jevCalls()).toBe(1)

  await tick()
  expect(w.logLines().map((l) => [l.outcome, l.tool_use_id, l.models])).toEqual([
    ['routed', 'p1', ['opus', 'sonnet']],
    ['verifier', 'p1', ['sonnet']],
  ])

  await $.turn.complete({ ...done, agentId: 'a1', answer: 'again' })
  await $.turn.complete({ ...done, agentId: 'a2', answer: 'verifier says' })
  await tick()
  expect(w.spawns).toHaveLength(2)
})

test('multiModel off: no verifier', async ($, on) => {
  const w = await world($, on)
  await w.call('p1')
  await $.turn.complete({ ...done, agentId: 'a1', answer: 'x' })
  await tick()
  expect(w.spawns).toHaveLength(1)
})

test('maxAgents full: the verifier is not spawned', { options: { ...MULTI, maxAgents: 1 } }, async ($, on) => {
  const w = await world($, on)
  await w.call('p1')
  await w.call('p2') // falls back on maxAgents, and still counts as active
  await $.turn.complete({ ...done, agentId: 'a1', answer: 'x' })
  await tick()
  expect(w.spawns).toHaveLength(2)
  expect(w.toasts).toContain('JEV: verifier not started: maxAgents')
})
