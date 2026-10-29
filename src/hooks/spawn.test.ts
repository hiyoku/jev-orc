import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test as baseTest, type Engine } from 'claude-code/testing'
import { FALLBACK_PROFILE } from '../agents/profiles'
import { LOG_PATH } from '../log'
import { MAX_AGENTS, PARALLELISM } from '../config'
import { STRINGS } from '../i18n'
import { TOTAL_KEY } from '../savings'
import { isOwnSpawn } from './spawn'
import { MAX_TASK_CHARS, type JevState } from '../jev/state'

// The world's status line is plain, so the strings below stay as they were; a test's own options win.
const test: typeof baseTest = ((name: string, a: any, b?: any) =>
  typeof a === 'function'
    ? baseTest(name, { options: { statusStyle: 'plain' } }, a)
    : baseTest(name, { ...a, options: { statusStyle: 'plain', ...a.options } }, b)) as never

const KEY = 'sk-test'
const HOME = '/home/u'
const TIMEOUT_MS = 8000
const START = { cwd: '/work', surface: null, isInteractive: false }
// Read-only, low complexity, low deliberation: haiku + low + t-read.
const READ_ONLY = {
  complexity: { score: 0.2, confidence: 0.9, probabilities: [0.8, 0.2, 0, 0] },
  deliberation: { score: 0, confidence: 1, probabilities: [1, 0, 0, 0, 0] },
  edits_files: { noul: 0 }, runs_shell: { noul: 0 }, web_research: { noul: 0 },
  library_docs: { noul: 0 }, browser: { noul: 0 },
}
// Writes, medium complexity: sonnet + t-read-edit.
const WRITES = { ...READ_ONLY, complexity: { score: 1.5, confidence: 0.9, probabilities: [0, 0.5, 0.5, 0] }, edits_files: { noul: 0.9 } }

type Agent = {
  tool_use_id: string; description: string; prompt: string; subagent_type?: string; name?: string; team_name?: string
  model?: string; effort?: string
}
type JevBody = { state: JevState }
type World = {
  env?: Record<string, string>
  jev?: (body: JevBody) => Promise<unknown> | unknown
  unregistered?: string
  // false: the plugin loads without session.start, as after a reload (an option change)
  start?: boolean
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
  const auths: (string | undefined)[] = []
  const registers: string[] = []
  const files = new Map<string, string>()
  const statuses: (string | undefined)[] = []
  // $.state held by the host: it outlives the plugin's module, as across a reload.
  const state = new Map<string, { value: unknown; version: number }>()
  const store = new Map<string, unknown>()
  mock.env(on, { HOME, ...(opts.env ?? { TYPESAFE_API_KEY: KEY }) })
  const clock = mock.clock(on)
  on('session.start', (_, e) => e)
  on('agent.register', (_, spec) => {
    registers.push(spec.name)
    if (spec.name === opts.unregistered) throw new Error('refused')
    return { value: { agent: `jev-orchestrator:${spec.name}` } }
  })
  on('agent.offer', () => ({ isOffered: true }))
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('state.get', (_, e) => ({ value: state.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e) => {
    const held = state.get(e.key) ?? { value: undefined, version: 0 }
    if (e.ifVersion !== undefined && e.ifVersion !== held.version) return { value: { isSet: false, version: held.version } }
    state.set(e.key, { value: e.value, version: held.version + 1 })
    return { value: { isSet: true, version: held.version + 1 } }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.read', (_, e) => ({ value: files.get(e.path)! }))
  on('fs.write', (_, e) => (files.set(e.path, e.text), { value: undefined }))
  on('http.fetch', async (_, e) => {
    const body = JSON.parse(e.init?.body ?? '{}') as JevBody
    bodies.push(body)
    auths.push(e.init?.headers?.Authorization)
    const answers = await (opts.jev ?? (() => READ_ONLY))(body)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } }
  })
  on('tool.call', async (_, e) => {
    const a = e as unknown as Agent
    tools.push(a)
    return { result: (await $.agent.spawn(spawnInput(a))) as never }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', async (_, e) => {
    const offered = await $.agent.offer({ agent: e.subagentType, description: '', source: e.provider.plugin === 'engine' ? 'built-in' : 'plugin', provider: e.provider })
    if (!offered.isOffered) throw new Error(`names no agent this call can dispatch: ${e.subagentType}`)
    spawns.push(e)
    return { model: e.model ?? 'inherit', agentId: `a-${e.tool_use_id}` }
  })
  if (opts.start !== false) await $.session.start(START)
  const logLines = () => (files.get(`${HOME}/${LOG_PATH}`) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { tools, spawns, toasts, bodies, auths, registers, clock, files, statuses, logLines, state, store }
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
  expect(w.bodies[0].state).toMatchObject({ tarefa_cortada: true, agente: { tipo: 'general-purpose' }, descricao: 'read file' })
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

test('missing key: fallback and a single toast', async ($, on) => {
  const w = await world($, on, { env: {} })
  await callAgent($, agent('k1'))
  await callAgent($, agent('k2'))
  expect(w.bodies).toHaveLength(0)
  expect(w.toasts).toHaveLength(1)
  expect(w.spawns.map((s) => s.subagentType)).toEqual([FALLBACK_PROFILE, FALLBACK_PROFILE])
  expect(w.toasts[0]).toContain('/plugin → Installed → jev-orchestrator → Configure options')
  expect(w.toasts[0]).toContain('TYPESAFE_API_KEY')
})

const OPTION_KEY = 'fake-option-key-not-real'

test('the key option wins over the environment and never leaks', { options: { typesafeApiKey: OPTION_KEY, logLevel: 'debug' } }, async ($, on) => {
  const w = await world($, on, { env: { TYPESAFE_API_KEY: KEY, JEV_API_KEY: KEY } })
  await callAgent($, agent('o1'))
  expect(w.auths).toEqual([`Bearer ${OPTION_KEY}`])
  expect(w.spawns[0].model).toBe('haiku')
  // Everything the world captured, but the request itself.
  const seen = JSON.stringify({ toasts: w.toasts, statuses: w.statuses, files: [...w.files], spawns: w.spawns, tools: w.tools, state: [...w.state] })
  expect(seen.includes(OPTION_KEY)).toBe(false)
})

test('the key option never leaks on a failed call', { options: { typesafeApiKey: OPTION_KEY, logLevel: 'debug' } }, async ($, on) => {
  const w = await world($, on, { jev: () => { throw new Error(`echo ${OPTION_KEY}`) } })
  await callAgent($, agent('o2'))
  expect(w.spawns[0].subagentType).toBe(FALLBACK_PROFILE)
  const seen = JSON.stringify({ toasts: w.toasts, statuses: w.statuses, files: [...w.files], spawns: w.spawns, tools: w.tools, state: [...w.state] })
  expect(seen.includes(OPTION_KEY)).toBe(false)
})

test('pt-BR: the missing-key toast is Portuguese and the key option still never leaks', { options: { language: 'pt-BR', typesafeApiKey: OPTION_KEY, logLevel: 'debug' } }, async ($, on) => {
  const w = await world($, on, { jev: () => { throw new Error(`echo ${OPTION_KEY}`) } })
  await callAgent($, agent('o3'))
  expect(w.spawns[0].subagentType).toBe(FALLBACK_PROFILE)
  expect(w.statuses.at(-1)).toContain('fallback')
  const seen = JSON.stringify({ toasts: w.toasts, statuses: w.statuses, files: [...w.files], spawns: w.spawns, tools: w.tools, state: [...w.state] })
  expect(seen.includes(OPTION_KEY)).toBe(false)
})

test('pt-BR: missing key toast', { options: { language: 'pt-BR' } }, async ($, on) => {
  const w = await world($, on, { env: {} })
  await callAgent($, agent('k3'))
  expect(w.toasts[0]).toContain('chave ausente')
})

for (const blank of ['', '   ']) {
  test(`a blank key option (${JSON.stringify(blank)}) falls back to the environment`, { options: { typesafeApiKey: blank } }, async ($, on) => {
    const w = await world($, on)
    await callAgent($, agent('b1'))
    expect(w.auths).toEqual([`Bearer ${KEY}`])
  })
}

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
  await callAgent($, agent('mate', { name: 'scout', team_name: 'crew' }))
  expect(w.tools.map((t) => t.effort)).toEqual([undefined, undefined])
  expect(w.bodies).toHaveLength(0)
  expect(w.spawns.map((s) => s.subagentType)).toEqual(['fork', 'general-purpose'])
  expect(w.spawns.map((s) => s.model)).toEqual([undefined, undefined])
})

test('a named subagent that is not a teammate is routed', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('named', { name: 'scout' }))
  expect(w.tools[0].effort).toBe('low')
  expect(w.spawns[0].model).toBe('haiku')
  expect(w.spawns[0].subagentType).toBe('jev-orchestrator:t-read')
})

test('a type outside the scope is preserved', async ($, on) => {
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


// Recursion guard

// The kit loads a plugin once, so no inline plugin can carry this plugin's origin: the
// predicate both hooks share is checked directly (spike H6 saw the origin at runtime).
test('a spawn this plugin caused, or on its own profile, is its own', () => {
  expect(isOwnSpawn('jev-orchestrator', 'jev-orchestrator', 'general-purpose')).toBe(true)
  expect(isOwnSpawn('engine', 'jev-orchestrator', 'jev-orchestrator:t-read')).toBe(true)
  expect(isOwnSpawn('engine', 'jev-orchestrator', 'general-purpose')).toBe(false)
})

test('a jev-orchestrator:* type does not call the JEV', async ($, on) => {
  const w = await world($, on)
  // The call itself is refused beneath: agent.offer hides the profile outside a routed call.
  await callAgent($, agent('own', { subagent_type: 'jev-orchestrator:t-read' })).catch(() => {})
  expect(w.bodies).toHaveLength(0)
  expect(w.tools[0].effort).toBeUndefined()
})

test('a repeated tool_use_id is routed once', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('same'))
  await callAgent($, agent('same'))
  expect(w.bodies).toHaveLength(1)
  expect(w.spawns.map((s) => s.model)).toEqual(['haiku', undefined])
})

// Concurrency

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

test('MAX_AGENTS parallel spawns: right decisions, at most PARALLELISM JEV calls in flight', async ($, on) => {
  let inFlight = 0
  let peak = 0
  const w = await world($, on, {
    jev: async (body) => {
      peak = Math.max(peak, ++inFlight)
      await tick()
      inFlight--
      return body.state.tarefa === 'edit' ? WRITES : READ_ONLY
    },
  })
  const ids = Array.from({ length: MAX_AGENTS }, (_, i) => `p${i}`)
  await Promise.all(ids.map((id, i) => callAgent($, agent(id, { prompt: i % 2 ? 'edit' : 'read' }))))
  expect(peak).toBe(PARALLELISM)
  expect(w.bodies).toHaveLength(MAX_AGENTS)
  expect(new Set(w.registers).size).toBe(w.registers.length)
  for (const [i, id] of ids.entries()) {
    const spawn = w.spawns.find((s) => s.tool_use_id === id)!
    expect(spawn.model).toBe(i % 2 ? 'sonnet' : 'haiku')
    expect(spawn.subagentType).toBe(i % 2 ? 'jev-orchestrator:t-read-edit' : 'jev-orchestrator:t-read')
  }
})

test('a queue wait that would overrun the hook budget falls back', async ($, on) => {
  const w = await world($, on, { jev: () => new Promise(() => {}) })
  const holders = Array.from({ length: PARALLELISM }, (_, i) => callAgent($, agent(`holder${i}`)))
  const queued = callAgent($, agent('queued'))
  await w.clock.advance(1500) // budget 10000 - JEV_TIMEOUT_MS 8000 - margin 500
  await queued
  expect(w.bodies).toHaveLength(PARALLELISM)
  expect(w.spawns[0].tool_use_id).toBe('queued')
  expect(w.spawns[0].subagentType).toBe(FALLBACK_PROFILE)
  await w.clock.advance(TIMEOUT_MS)
  await Promise.all(holders)
})

test('the agent limit falls back until a routed agent completes', async ($, on) => {
  const w = await world($, on)
  for (let i = 0; i < MAX_AGENTS; i++) await callAgent($, agent(`m${i}`))
  await callAgent($, agent('over'))
  expect(w.bodies).toHaveLength(MAX_AGENTS)
  expect(w.spawns.at(-1)!.subagentType).toBe(FALLBACK_PROFILE)
  const done = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
  await $.turn.complete({ ...done }) // the main loop's turn frees nothing
  await callAgent($, agent('still'))
  expect(w.bodies).toHaveLength(MAX_AGENTS)
  for (const id of ['a-m0', 'a-over', 'a-still']) await $.turn.complete({ ...done, agentId: id })
  await callAgent($, agent('again'))
  expect(w.bodies).toHaveLength(MAX_AGENTS + 1)
  expect(w.spawns.at(-1)!.subagentType).toBe('jev-orchestrator:t-read')
})

test('a burst of Agent calls routes at most MAX_AGENTS, the rest falls back', async ($, on) => {
  const w = await world($, on, { jev: async () => (await tick(), READ_ONLY) })
  const ids = Array.from({ length: MAX_AGENTS + 3 }, (_, i) => `b${i}`)
  await Promise.all(ids.map((id) => callAgent($, agent(id))))
  await settle()
  expect(w.bodies).toHaveLength(MAX_AGENTS)
  expect(w.spawns.filter((s) => s.subagentType === 'jev-orchestrator:t-read')).toHaveLength(MAX_AGENTS)
  const fallbacks = w.logLines().filter((l) => l.outcome === 'fallback')
  expect(fallbacks).toHaveLength(3)
  for (const l of fallbacks) expect(l.reasons).toEqual(['maxAgents'])
})

// Decision log

const settle = async () => { for (let i = 0; i < 20; i++) await tick() }

test('one log line per routed spawn, and the status names the routing', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('l1', { description: '[jev] read file' }))
  await settle()
  const lines = w.logLines()
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({
    tool_use_id: 'l1', description: 'read file', outcome: 'routed', models: ['haiku'], effort: 'low',
    profile: 'jev-orchestrator:t-read', jev: { complexity: 0.2, complexity_confidence: 0.9, deliberation: 0 },
  })
  expect(w.statuses.at(-1)).toBe('jev ON · haiku·low·t-read')
})

test('fallback logs the error kind and never the key', async ($, on) => {
  const w = await world($, on, { jev: () => new Promise(() => {}) })
  const call = callAgent($, agent('slow'))
  await w.clock.advance(TIMEOUT_MS)
  await call
  await settle()
  expect(w.logLines()[0]).toMatchObject({ outcome: 'fallback', error: 'timeout', models: ['sonnet'], effort: 'medium' })
  expect(w.statuses.at(-1)).toBe('jev ON · fallback (timeout)')
  for (const text of w.files.values()) expect(text).not.toContain(KEY)
})

test('the key never reaches the log, even at debug with a bad payload', { options: { logLevel: 'debug' } }, async ($, on) => {
  const w = await world($, on, { jev: () => ({ broken: true }) })
  await callAgent($, agent('bad', { prompt: `use ${KEY}`.padEnd(400, '.') }))
  await settle()
  expect(w.logLines()[0]).toMatchObject({ outcome: 'fallback', error: 'bad_payload' })
  expect(w.logLines()[0].jev_request.tarefa).toHaveLength(200)
  for (const text of w.files.values()) expect(text).not.toContain('Bearer')
})

test('logLevel off writes nothing', { options: { logLevel: 'off' } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('quiet'))
  await settle()
  expect(w.files.size).toBe(0)
})

test('10 parallel spawns write 10 whole lines', async ($, on) => {
  const w = await world($, on)
  const ids = Array.from({ length: 10 }, (_, i) => `q${i}`)
  await Promise.all(ids.map((id) => callAgent($, agent(id))))
  await settle()
  expect(w.logLines().map((l) => l.tool_use_id).sort()).toEqual([...ids].sort())
})

// Savings status

const usage = { input_tokens: 40_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const done = { durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', answer: 'ok' } as const

test('session.start shows ON', async ($, on) => {
  expect((await world($, on)).statuses.at(-1)).toBe('jev ON')
})

test('mode off shows OFF', { options: { mode: 'off' } }, async ($, on) => {
  expect((await world($, on)).statuses.at(-1)).toBe('jev OFF')
})

test('a routed agent turn adds its usage, priced at its model against the parent model', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('s1'))
  await $.turn.complete({ ...done, agentId: 'a-s1', usage: { ...usage, model: 'claude-haiku-5-5' } })
  // haiku: 40k*0.1 + 2k*0.5 = $0.005 for the agent; the parent (haiku) costs the same
  expect(w.statuses.at(-1)).toBe('jev ON · haiku·low·t-read · 42k tok $0.005 · vs haiku/? ~$0.005 (0%) · total $0.005 (0%)')
})

test('showStatus false: no status line, the mode and the total still reach $.state', { options: { showStatus: false } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('s1'))
  await $.turn.complete({ ...done, agentId: 'a-s1', usage: { ...usage, model: 'claude-haiku-5-5' } })
  // the load clears a line an earlier load drew; nothing draws one after
  expect(w.statuses).toEqual([undefined])
  expect(w.state.get('mode')?.value).toBe('auto')
  expect(w.state.get('total')?.value).toMatchObject({ agents: 1, cost: 0.005 })
})

test('showStatus false: a reload clears the line at its first turn, once', { options: { showStatus: false } }, async ($, on) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  const w = await world($, on, { start: false })
  await $.turn.start({ text: 'hi', turnId: 'c1' })
  await $.turn.start({ text: 'hi', turnId: 'c2' })
  expect(w.statuses).toEqual([undefined])
})

test('a reload registers the profiles at its first Agent call', async ($, on) => {
  const w = await world($, on, { start: false })
  expect(w.registers).toEqual([])
  await callAgent($, agent('r1'))
  expect(w.registers.length).toBeGreaterThan(0)
  expect(w.spawns[0].subagentType).toBe('jev-orchestrator:t-read')
})

test('a reload speaks the session language at its first Agent call', async ($, on) => {
  const w = await world($, on, { start: false, env: { LANG: 'pt_BR.UTF-8' } })
  await callAgent($, agent('r2'))
  expect(w.toasts).toContain(STRINGS['pt-BR'].toastMissingKey)
})

test('the key status names its source and never holds the key', async ($, on) => {
  const w = await world($, on)
  const status = w.state.get('key')?.value
  expect(status).toEqual({ source: 'TYPESAFE_API_KEY', env: { TYPESAFE_API_KEY: true, JEV_API_KEY: false }, endpoint: 'api.typesafe.ai' })
  expect(JSON.stringify(status)).not.toContain(KEY)
})

test('the key status: the option wins over both variables', { options: { typesafeApiKey: 'fake-option-key' } }, async ($, on) => {
  const w = await world($, on, { env: { TYPESAFE_API_KEY: KEY, JEV_API_KEY: KEY } })
  const status = w.state.get('key')?.value
  expect(status).toMatchObject({ source: 'option', env: { TYPESAFE_API_KEY: true, JEV_API_KEY: true } })
  expect(JSON.stringify(status)).not.toContain('fake-option-key')
})

test('the key status: JEV_API_KEY when TYPESAFE_API_KEY is blank', async ($, on) => {
  const w = await world($, on, { env: { TYPESAFE_API_KEY: '  ', JEV_API_KEY: KEY } })
  expect(w.state.get('key')?.value).toMatchObject({ source: 'JEV_API_KEY', env: { TYPESAFE_API_KEY: false, JEV_API_KEY: true } })
})

test('the key status: none without a key', async ($, on) => {
  const w = await world($, on, { env: {} })
  expect(w.state.get('key')?.value).toMatchObject({ source: 'none', env: { TYPESAFE_API_KEY: false, JEV_API_KEY: false } })
})

test('statusStyle nerd: the last status carries the icons', { options: { statusStyle: 'nerd' } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('n1'))
  await $.turn.complete({ ...done, agentId: 'a-n1', usage: { ...usage, model: 'claude-haiku-5-5' } })
  expect(w.statuses.at(-1)).toBe(
    '\uf011 jev ON │ \uf0e7 haiku·low·t-read │ \uf1c0 42k tok │ \uf0d6 $0.005 │ \uf0ec vs haiku/? ~$0.005 (0%) │ \uf1da total $0.005 (0%)',
  )
})

test('compareModel fable: priced and named as fable', { options: { compareModel: 'fable' } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('f1'))
  await $.turn.complete({ ...done, agentId: 'a-f1', usage: { ...usage, model: 'claude-haiku-5-5' } })
  const last = w.statuses.at(-1)!
  expect(last).toContain(' · vs fable ~$')
  expect(last).not.toContain('vs fable/')
})

test('the savings survive a module reload, kept in $.state', async ($, on) => {
  const w = await world($, on)
  w.state.set('savings', { version: 1, value: { agents: 1, tokens: 1000, cost: 0.5, estimated: 1, jevCalls: 0, parent: 'opus', route: '' } })
  await callAgent($, agent('s2'))
  await $.turn.complete({ ...done, agentId: 'a-s2', usage: { ...usage, model: 'claude-haiku-5-5' } })
  expect(w.state.get('savings')?.value).toMatchObject({ agents: 2, tokens: 43_000 })
  expect(w.statuses.at(-1)).toContain('43k tok')
})

test('the total across sessions is kept in $.store and shown', async ($, on) => {
  const w = await world($, on)
  w.store.set(TOTAL_KEY, { agents: 9, tokens: 1000, cost: 1, estimated: 2, jevCalls: 0, parent: 'opus', route: '' })
  await callAgent($, agent('s3'))
  await $.turn.complete({ ...done, agentId: 'a-s3', usage: { ...usage, model: 'claude-haiku-5-5' } })
  expect(w.store.get(TOTAL_KEY)).toMatchObject({ agents: 10, tokens: 43_000, jevCalls: 1 })
  expect(w.statuses.at(-1)).toContain(' · total $1.00 (-50%)')
})

test('a turn without a routed agent changes nothing', async ($, on) => {
  const w = await world($, on)
  await $.turn.complete({ ...done, agentId: 'stranger', usage: { ...usage, model: 'claude-haiku-5-5' } })
  expect(w.state.has('savings')).toBe(false)
  expect(w.statuses.at(-1)).toBe('jev ON')
})

// mainEffort: the test's turn.step hook stands for the API and records the effort each request asked.
function stepper(on: On) {
  const efforts: unknown[] = []
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const step = async ($: Engine, turnId: string, model: string, agentId?: string) => {
    for await (const _ of $.turn.step({ turnId, index: 0, model, effort: 'high', messageCount: 1, agentId } as never));
  }
  return { efforts, step }
}

test('mainEffort is off by default: no JEV call, the prompt keeps its effort', async ($, on) => {
  const s = stepper(on)
  const w = await world($, on)
  await $.turn.start({ text: 'commit this', turnId: 'm0' })
  await s.step($, 'm0', 'claude-sonnet-5-5')
  expect(w.bodies).toHaveLength(0)
  expect(s.efforts).toEqual(['high'])
  expect(w.statuses.at(-1)).toBe('jev ON — high')
})

test('mainEffort: JEV sets the main turn effort only, until the turn completes', { options: { mainEffort: true } }, async ($, on) => {
  const s = stepper(on)
  const w = await world($, on)
  await $.turn.start({ text: 'commit this', turnId: 'm1' })
  await s.step($, 'm1', 'claude-sonnet-5-5')
  await s.step($, 'm1', 'claude-sonnet-5-5', 'a-sub')
  await $.turn.complete({ ...done, turnId: 'm1' })
  await s.step($, 'm1', 'claude-sonnet-5-5')
  // deliberation level 0 -> low; a subagent's request and a finished turn keep theirs
  expect(s.efforts).toEqual(['low', 'high', 'high'])
  expect(w.bodies[0].state).toMatchObject({ tarefa: 'commit this', origem: 'the user typing to the coding agent in the main session' })
  expect(w.statuses.at(-1)).toContain('prompt·low')
  // the dash shows the main loop's effort as run, not a subagent's
  expect(w.statuses.at(-1)).toMatch(/ — high$/)
  expect(w.statuses).toContain('jev ON · prompt·low — low')
  expect(w.files.get(`${HOME}/${LOG_PATH}`)).toContain('"outcome":"main"')
})

test('mainEffort: maxEffort bounds the pick', { options: { mainEffort: true, maxEffort: 'medium' } }, async ($, on) => {
  const s = stepper(on)
  await world($, on, { jev: () => ({ ...READ_ONLY, deliberation: { score: 4, confidence: 1, probabilities: [0, 0, 0, 0, 1] } }) })
  await $.turn.start({ text: 'design the cache', turnId: 'm2' })
  await s.step($, 'm2', 'claude-opus-5-5')
  // deliberation level 4 asks for max: capped at medium
  expect(s.efforts).toEqual(['medium'])
})

test('mainEffort: without JEV the prompt keeps its effort', { options: { mainEffort: true } }, async ($, on) => {
  const s = stepper(on)
  const w = await world($, on, { env: {} })
  await $.turn.start({ text: 'commit this', turnId: 'm3' })
  await s.step($, 'm3', 'claude-sonnet-5-5')
  expect(s.efforts).toEqual(['high'])
  expect(w.files.get(`${HOME}/${LOG_PATH}`)).toContain('"error":"missing_key"')
})

test('maxEffort also caps the main prompt\'s own effort, without mainEffort', { options: { maxEffort: 'medium' } }, async ($, on) => {
  const s = stepper(on)
  const w = await world($, on)
  await $.turn.start({ text: 'commit this', turnId: 'm4' })
  await s.step($, 'm4', 'claude-sonnet-5-5')
  await s.step($, 'm4', 'claude-sonnet-5-5', 'a-sub')
  // high -> medium for the main loop; a subagent's request is left to its own routing
  expect(s.efforts).toEqual(['medium', 'high'])
  expect(w.bodies).toHaveLength(0)
})

test('mode=off leaves the main prompt\'s effort untouched', { options: { maxEffort: 'low', mode: 'off' } }, async ($, on) => {
  const s = stepper(on)
  await world($, on)
  await $.turn.start({ text: 'commit this', turnId: 'm5' })
  await s.step($, 'm5', 'claude-sonnet-5-5')
  expect(s.efforts).toEqual(['high'])
})

const ENGINE = { plugin: 'engine', tier: 'core' } as const
const OTHER = { plugin: 'feature-dev', tier: 'user' } as const

test('builtin scope routes Claude Code\'s own agents and leaves a plugin\'s alone', async ($, on) => {
  const w = await world($, on)
  await $.agent.offer({ agent: 'Plan', description: 'Software architect agent', source: 'built-in', provider: ENGINE })
  await $.agent.offer({ agent: 'feature-dev:code-reviewer', description: 'Reviews code', source: 'plugin', provider: OTHER })
  await callAgent($, agent('p1', { subagent_type: 'Plan' }))
  await callAgent($, agent('p2', { subagent_type: 'feature-dev:code-reviewer' }))
  expect(w.bodies).toHaveLength(1)
  expect(w.tools[0].effort).toBe('low')
  expect(w.tools[1].effort).toBeUndefined()
})

test('builtin scope leaves a .claude/agents agent alone even under a built-in\'s name', async ($, on) => {
  const w = await world($, on)
  await $.agent.offer({ agent: 'Explore', description: 'my own explorer', source: 'projectSettings', provider: ENGINE })
  await callAgent($, agent('x1', { subagent_type: 'Explore' }))
  expect(w.bodies).toHaveLength(0)
  expect(w.tools[0].effort).toBeUndefined()
})

test('scope all routes a .claude/agents agent and a plugin agent too', { options: { agentScope: 'all' } }, async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('c1', { subagent_type: 'go-code-reviewer' }))
  await callAgent($, agent('c2', { subagent_type: 'feature-dev:code-reviewer' }))
  expect(w.bodies).toHaveLength(2)
  expect(w.tools.map((t) => t.effort)).toEqual(['low', 'low'])
})

test('JEV reads the host\'s listing line beside the agent name, cut to 120 characters', async ($, on) => {
  const w = await world($, on)
  const listing = `Software architect. ${'x'.repeat(200)}`
  await $.agent.offer({ agent: 'Plan', description: listing, source: 'built-in', provider: ENGINE })
  await callAgent($, agent('h1', { subagent_type: 'Plan' }))
  expect(w.bodies[0].state.agente).toEqual({ tipo: 'Plan', dica: listing.slice(0, 120) })
})

test('agentHints wins over the host\'s listing line', { options: { agentHints: 'Plan=plans, never edits' } }, async ($, on) => {
  const w = await world($, on)
  await $.agent.offer({ agent: 'Plan', description: 'Software architect agent', source: 'built-in', provider: ENGINE })
  await callAgent($, agent('h2', { subagent_type: 'Plan' }))
  expect(w.bodies[0].state.agente).toEqual({ tipo: 'Plan', dica: 'plans, never edits' })
})

test('JEV reads the description without the [jev] marker', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('d1', { description: '[jev] read file' }))
  expect(w.bodies[0].state.descricao).toBe('read file')
})

test('a routed Plan keeps its type and gets the model and the effort', async ($, on) => {
  const w = await world($, on)
  await $.agent.offer({ agent: 'Plan', description: 'Software architect agent', source: 'built-in', provider: ENGINE })
  await callAgent($, agent('k1', { subagent_type: 'Plan' }))
  expect(w.tools[0].effort).toBe('low')
  expect(w.spawns[0].subagentType).toBe('Plan')
  expect(w.spawns[0].model).toBe('haiku')
})

test('scope all: a .claude/agents agent keeps its type, also on the fallback', { options: { agentScope: 'all' } }, async ($, on) => {
  const w = await world($, on, { env: {} })
  await callAgent($, agent('k2', { subagent_type: 'go-code-reviewer' }))
  expect(w.spawns[0].subagentType).toBe('go-code-reviewer')
  expect(w.spawns[0].model).toBe('sonnet')
})

test('claude is generic: it still trades its type for a tool profile', async ($, on) => {
  const w = await world($, on)
  await callAgent($, agent('k3', { subagent_type: 'claude' }))
  expect(w.spawns[0].subagentType).toBe('jev-orchestrator:t-read')
})

test('scope all: a .claude/agents agent named like a generic one keeps its type', { options: { agentScope: 'all' } }, async ($, on) => {
  const w = await world($, on)
  await $.agent.offer({ agent: 'Explore', description: 'my own explorer', source: 'projectSettings', provider: ENGINE })
  await callAgent($, agent('s1', { subagent_type: 'Explore' }))
  expect(w.tools[0].effort).toBe('low')
  expect(w.spawns[0].subagentType).toBe('Explore')
  expect(w.spawns[0].model).toBe('haiku')
})
