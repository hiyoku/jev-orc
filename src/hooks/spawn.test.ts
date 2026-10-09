import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'
import { FALLBACK_PROFILE } from '../agents/profiles'
import { MAX_TASK_CHARS } from './spawn'

const KEY = 'sk-test'
const TIMEOUT_MS = 8000
const START = { cwd: '/work', surface: null, isInteractive: false }
// Read-only, low complexity, low deliberation: haiku + low + t-read.
const READ_ONLY = {
  complexity: { score: 0.2, confidence: 0.9 },
  deliberation: { noul: 0.1 },
  edits_files: { noul: 0 }, runs_shell: { noul: 0 }, web_research: { noul: 0 },
  library_docs: { noul: 0 }, browser: { noul: 0 },
}
// Writes, medium complexity: sonnet + t-read-edit.
const WRITES = { ...READ_ONLY, complexity: { score: 1.5, confidence: 0.9 }, edits_files: { noul: 0.9 } }

type Agent = { tool_use_id: string; description: string; prompt: string; subagent_type?: string; name?: string; model?: string; effort?: string }
type JevBody = { state: { tarefa: string; contexto: string } }
type World = {
  env?: Record<string, string>
  jev?: (body: JevBody) => Promise<unknown> | unknown
  unregistered?: string
}

const spawnInput = (a: Agent, extra: Partial<AgentSpawnInput> = {}): AgentSpawnInput => ({
  tool_use_id: a.tool_use_id, prompt: a.prompt, description: a.description,
  subagentType: a.subagent_type ?? 'general-purpose', model: a.model, provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-haiku-5-5', background: true, fork: a.subagent_type === 'fork', ...extra,
})

// The test's hooks stand for the engine: profile registration, the Agent tool (which raises
// agent.spawn and, as core does, refuses a type agent.offer hides), the JEV endpoint and toasts.
async function world($: Engine, on: On, opts: World = {}) {
  const tools: Agent[] = []
  const spawns: AgentSpawnInput[] = []
  const toasts: string[] = []
  const bodies: JevBody[] = []
  mock.env(on, opts.env ?? { TYPESAFE_API_KEY: KEY })
  const clock = mock.clock(on)
  on('session.start', (_, e) => e)
  on('agent.register', (_, spec) => {
    if (spec.name === opts.unregistered) throw new Error('refused')
    return { value: { agent: `jev-orchestrator:${spec.name}` } }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('http.fetch', async (_, e) => {
    const body = JSON.parse(e.init?.body ?? '{}') as JevBody
    bodies.push(body)
    const answers = await (opts.jev ?? (() => READ_ONLY))(body)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } }
  })
  on('tool.call', async (_, e) => {
    const a = e as unknown as Agent
    tools.push(a)
    return { result: (await $.agent.spawn(spawnInput(a))) as never }
  })
  on('agent.spawn', async (_, e) => {
    const offered = await $.agent.offer({ agent: e.subagentType, description: '', source: 'plugin', provider: e.provider })
    if (!offered.isOffered) throw new Error(`names no agent this call can dispatch: ${e.subagentType}`)
    spawns.push(e)
    return { model: e.model ?? 'inherit', agentId: `a-${e.tool_use_id}` }
  })
  await $.session.start(START)
  return { tools, spawns, toasts, bodies, clock }
}

const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({
  tool_use_id: id, description: 'read file', prompt: 'read README', subagent_type: 'general-purpose', ...extra,
})

const callAgent = ($: Engine, a: Agent) => $.tool.call({ tool: 'Agent', ...a } as never)

test('happy path: effort at tool.call, model and profile at spawn, by tool_use_id', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('t1', { prompt: 'x'.repeat(MAX_TASK_CHARS + 50) }))
  expect(w.tools[0].effort).toBe('low')
  expect(w.bodies[0].state.tarefa).toHaveLength(MAX_TASK_CHARS)
  expect(w.bodies[0].state.contexto).toBe('general-purpose: read file')
  expect(w.spawns[0].tool_use_id).toBe('t1')
  expect(w.spawns[0].model).toBe('haiku')
  expect(w.spawns[0].subagentType).toBe('jev-orchestrator:t-read')
})

test('profiles stay hidden from the model outside their own call', async ($, on) => {
  await world($, on)
  await callAgent($, agent('t1'))
  const provider = { plugin: 'jev-orchestrator', tier: 'user' } as const
  expect(await $.agent.offer({ agent: 'jev-orchestrator:t-read', description: '', source: 'plugin', provider })).toEqual({ isOffered: false })
})

test('spawn without a decision is untouched', async ($, on) => {
  const w = await world($, on)
  await $.agent.spawn(spawnInput(agent('none')))
  expect(w.spawns[0].model).toBeUndefined()
  expect(w.spawns[0].subagentType).toBe('general-purpose')
})

test('JEV timeout falls back, with fallbackEffort', async ($, on) => {
  const w = await world($, on, { jev: () => new Promise(() => {}) })
  const call = callAgent($, agent('slow'))
  await w.clock.advance(TIMEOUT_MS)
  await call
  expect(w.tools[0].effort).toBe('medium')
  expect(w.spawns[0].model).toBe('sonnet')
  expect(w.spawns[0].subagentType).toBe(FALLBACK_PROFILE)
})

test('fallback applies a configured fallbackEffort', { options: { fallbackEffort: 'low' } }, async ($, on) => {
  const w = await world($, on, { env: {} })
  await callAgent($, agent('fe'))
  expect(w.tools[0].effort).toBe('low')
})

test('missing key: fallback and a single toast', async ($, on) => {
  const w = await world($, on, { env: {} })
  await callAgent($, agent('k1'))
  await callAgent($, agent('k2'))
  expect(w.bodies).toHaveLength(0)
  expect(w.toasts).toHaveLength(1)
  expect(w.spawns.map((s) => s.subagentType)).toEqual([FALLBACK_PROFILE, FALLBACK_PROFILE])
})

test('mode=off touches nothing', { options: { mode: 'off' } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('off'))
  expect(w.tools[0].effort).toBeUndefined()
  expect(w.bodies).toHaveLength(0)
  expect(w.spawns[0].model).toBeUndefined()
  expect(w.spawns[0].subagentType).toBe('general-purpose')
})

test('explicit: only [jev]-marked calls are routed, and the marker is removed', { options: { mode: 'explicit' } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('plain'))
  await callAgent($, agent('marked', { description: '[jev] read file' }))
  expect(w.tools[0].effort).toBeUndefined()
  expect(w.spawns[0].subagentType).toBe('general-purpose')
  expect(w.tools[1].effort).toBe('low')
  expect(w.tools[1].description).toBe('read file')
  expect(w.spawns[1].subagentType).toBe('jev-orchestrator:t-read')
  expect(w.bodies).toHaveLength(1)
})

test('forks and teammates are untouched', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('fork', { subagent_type: 'fork' }))
  await callAgent($, agent('mate', { name: 'scout' }))
  expect(w.tools.map((t) => t.effort)).toEqual([undefined, undefined])
  expect(w.bodies).toHaveLength(0)
  expect(w.spawns.map((s) => s.subagentType)).toEqual(['fork', 'general-purpose'])
  expect(w.spawns.map((s) => s.model)).toEqual([undefined, undefined])
})

test('a type outside agentsIntercept is preserved', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('go', { subagent_type: 'go-code-reviewer' }))
  expect(w.tools[0].effort).toBeUndefined()
  expect(w.spawns[0].subagentType).toBe('go-code-reviewer')
  expect(w.spawns[0].model).toBeUndefined()
})

test('a profile whose registration failed gets the model only', async ($, on) => {
  const w = await world($, on, { unregistered: 't-read' })
  await callAgent($, agent('noprof'))
  expect(w.tools[0].effort).toBe('low')
  expect(w.spawns[0].model).toBe('haiku')
  expect(w.spawns[0].subagentType).toBe('general-purpose')
})

test('concurrent spawns with different tool_use_ids do not mix', async ($, on) => {
  const w = await world($, on, { jev: (body) => (body.state.tarefa === 'edit' ? WRITES : READ_ONLY) })
  await Promise.all([callAgent($, agent('r')), callAgent($, agent('g', { prompt: 'edit' }))])
  const byId = Object.fromEntries(w.spawns.map((s) => [s.tool_use_id, s]))
  expect(byId.r.model).toBe('haiku')
  expect(byId.r.subagentType).toBe('jev-orchestrator:t-read')
  expect(byId.g.model).toBe('sonnet')
  expect(byId.g.subagentType).toBe('jev-orchestrator:t-read-edit')
  expect(w.tools.find((t) => t.tool_use_id === 'g')?.effort).toBe('low')
})
