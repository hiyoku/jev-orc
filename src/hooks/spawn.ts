import { update, type AgentSpawnResult, type EngineInterface, type On } from 'claude-code'
import { FALLBACK_PROFILE, PROFILE_MATCHER, profileFor } from '../agents/profiles'
import { HOOK_BUDGET_MS, type Config, type Effort, type LogLevel, type Model } from '../config'
import { decide } from '../domain/policy'
import type { JevAnswers } from '../jev/answers'
import { askJev, JevError, type JevErrorKind } from '../jev/client'
import { jevNumbers, logDecision, type LogEntry, type LogIo } from '../log'
import { addAgent, EMPTY_SAVINGS, formatStatus } from '../savings'
import type { Savings } from '../../types/index'

export const MAX_TASK_CHARS = 4000
const MARKER = /^\[jev\]\s*/
const DEFAULT_TYPE = 'general-purpose'
// What the hook keeps of its budget beyond the queue wait and the JEV timeout.
const QUEUE_MARGIN_MS = 500
const ROUTED_IDS_CAP = 1000
const VERIFY_PROFILE = 'jev-orchestrator:t-read'
const VERIFY_INSTRUCTION =
  'Review the answer above against the task. Point out errors, gaps and risks, citing file:line. Do not edit anything.'

// Literal, as $.state needs: the savings of this session, kept by the host across a module reload.
const SAVINGS = { plugin: 'jev-orchestrator', key: 'savings' } as const

// The status never reaches the routing: a failed state write leaves the old line.
async function track($: EngineInterface, config: Config, userEffort: string, change: (savings: Savings) => Savings) {
  try {
    const savings = await update($, SAVINGS, (value) => change(value ?? EMPTY_SAVINGS))
    $.ui.status(formatStatus(savings, config.mode, config.jevPricePerCall, userEffort))
  } catch {}
}

type JevIo = Parameters<typeof askJev>[0]
type HttpInit = Parameters<JevIo['http']['fetch']>[1]

type JevTask = { tarefa: string; contexto: string }

// The host follows $ only within this file, so the log gets literal calls, not $ itself.
// A failure toasts once per session (`warned`) and never reaches the routing.
function logTo($: EngineInterface, level: LogLevel, warned: { log: boolean }, entry: LogEntry, request?: JevTask) {
  const io: LogIo = {
    home: () => $.env.get('HOME'),
    exists: (path) => $.fs.exists(path),
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
  }
  logDecision(io, level, entry, request, () => {
    if (warned.log) return
    warned.log = true
    $.ui.toast('JEV: falha ao gravar o log de decisões')
  })
}

// A spawn this plugin caused, or one already on a profile of it, is never routed again.
export const isOwnSpawn = (originPlugin: string, self: string, type: string) =>
  originPlugin === self || PROFILE_MATCHER.test(type)

type Routed = { model: Model; verifier?: Model; effort: Effort; profile: string; reasons: string[] } | { skip: string }
type Verification = { tool_use_id: string; prompt: string; verifier: Model; description: string }

// tool.call (Agent) decides and applies the effort; agent.spawn, correlated by tool_use_id,
// applies model and tool profile. Fail-open: never a deny.
// `registered` holds the profiles whose registration succeeded; any other gets the model only.
export function routeAgentSpawns(on: On, config: Config, registered: ReadonlySet<string>) {
  const decisions = new Map<string, Routed>()
  // Profiles with an Agent call in flight. agent.offer also gates a rewritten subagentType, so a
  // profile is offered only during its own call and stays hidden from the model's listing.
  // ponytail: a listing built during that window shows the profile; a per-dispatch flag if the host adds one
  const dispatching = new Map<string, number>()
  let warnedMissingKey = false
  const warned = { log: false }
  // ponytail: oldest-first eviction past the cap; a repeat older than 1000 routings is routed again; revisit if decisions.jsonl shows a tool_use_id routed twice
  const routedIds = new Set<string>()
  // Routed agents running, by agentId, freed at their turn.complete.
  const active = new Set<string>()
  // Slots taken by Agent calls in flight, by tool_use_id: moved to `active` at agent.spawn,
  // released when the call ends without one.
  const reserved = new Set<string>()
  // Primaries whose decision named a verifier, by agentId, until their turn.complete.
  const pendingVerify = new Map<string, Verification>()
  // Routed agents (and verifiers) whose usage is still to be counted, by agentId, until their turn.complete.
  const costed = new Map<string, { routed: Model; parentModel?: string; isVerifier?: boolean }>()
  // The user's effort, as the main loop's last request asked for it; unknown until one is seen.
  let userEffort = '?'
  // Semaphore over the JEV calls in flight.
  let jevInFlight = 0
  const jevQueue: (() => void)[] = []
  // Waiting on the queue is the hook's own time (no $ call is in flight), and the JEV timeout is
  // a $.clock.sleep, paid from the budget too: the wait gets what is left of the budget after them.
  const maxQueueWaitMs = HOOK_BUDGET_MS - config.jevTimeoutMs - QUEUE_MARGIN_MS

  const acquireJev = async (sleep: (ms: number, signal: AbortSignal) => Promise<void>): Promise<boolean> => {
    if (jevInFlight < config.parallelism) return (jevInFlight++, true)
    if (maxQueueWaitMs <= 0) return false
    let grant!: () => void
    const granted = new Promise<void>((resolve) => (grant = resolve))
    jevQueue.push(grant)
    const timer = new AbortController()
    await Promise.race([granted, sleep(maxQueueWaitMs, timer.signal).catch(() => {})])
    timer.abort()
    const waiting = jevQueue.indexOf(grant)
    if (waiting === -1) return true // granted, even if in the same tick as the timeout
    jevQueue.splice(waiting, 1)
    return false
  }
  // A released slot passes straight to the next in the queue.
  const releaseJev = () => {
    const nextInQueue = jevQueue.shift()
    if (nextInQueue) nextInQueue()
    else jevInFlight--
  }

  const markRouted = (id: string) => {
    routedIds.add(id)
    if (routedIds.size > ROUTED_IDS_CAP) routedIds.delete(routedIds.values().next().value!)
  }

  on('turn.step', async function* (_$, e, next) {
    if (e.agentId === undefined && e.effort !== undefined) userEffort = String(e.effort)
    yield* next(e)
  })

  on('agent.offer', { agent: PROFILE_MATCHER }, (_$, e) => ({ isOffered: (dispatching.get(e.agent) ?? 0) > 0 }))

  const fallback = (reason: string): Routed => ({
    model: config.fallback.model,
    effort: config.fallback.effort,
    profile: FALLBACK_PROFILE,
    reasons: [reason],
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = e.subagent_type ?? DEFAULT_TYPE
    const marked = MARKER.test(e.description)
    const untouched =
      config.mode === 'off' ||
      (config.mode === 'explicit' && !marked) ||
      type === 'fork' ||
      // ponytail: the tool marks it deprecated and ignored; a teammate shows only at agent.spawn (isTeammate); revisit if the Agent tool exposes a non-deprecated teammate flag
      e.team_name !== undefined ||
      !config.agentsIntercept.includes(type) ||
      isOwnSpawn(next.origin.plugin, $.plugin.name, type) ||
      routedIds.has(e.tool_use_id)
    if (untouched) return next(e)
    markRouted(e.tool_use_id)

    let routed: Routed
    let answers: JevAnswers | undefined
    let asked: JevTask | undefined
    let error: JevErrorKind | undefined
    let fellBack = false
    try {
      const forced = decide(undefined, config)
      if ('skip' in forced) {
        if (active.size + reserved.size >= config.maxAgents) throw new Error('maxAgents')
        reserved.add(e.tool_use_id)
        if (!(await acquireJev((ms, signal) => $.clock.sleep(ms, { signal })))) throw new Error('parallelism')
        const task = { tarefa: e.prompt.slice(0, MAX_TASK_CHARS), contexto: `${type}: ${e.description}` }
        // The host follows $ only within this file, so askJev gets literal calls, not $ itself.
        const io = {
          env: { get: (name: string) => (name === 'JEV_API_KEY' ? $.env.get('JEV_API_KEY') : $.env.get('TYPESAFE_API_KEY')) },
          http: { fetch: (url: string, init?: HttpInit) => $.http.fetch(url, init) },
          clock: { sleep: (ms: number) => $.clock.sleep(ms) },
        } as JevIo
        asked = task
        try {
          answers = await askJev(io, task, config)
        } finally {
          releaseJev()
        }
      }
      const decision = answers ? decide(answers, config) : forced
      const profile = profileFor(decision, config)
      if ('skip' in decision) routed = decision
      else if (!profile) routed = { skip: `sem perfil para ${decision.toolGroups.join(',')}` }
      else routed = { model: decision.models[0], verifier: decision.models[1], effort: decision.effort, profile, reasons: decision.reasons }
    } catch (err) {
      if (err instanceof JevError && err.kind === 'missing_key' && !warnedMissingKey) {
        warnedMissingKey = true
        $.ui.toast('JEV: chave ausente, usando o fallback; defina a chave em /plugin → Installed → jev-orchestrator → Configure options, ou em TYPESAFE_API_KEY')
      }
      if (err instanceof JevError) error = err.kind
      fellBack = true
      routed = fallback(error ?? (err instanceof Error ? err.message : String(err)))
    }

    if ('skip' in routed) reserved.delete(e.tool_use_id)

    let route: string | undefined
    const description = e.description.replace(MARKER, '')
    const decided = { tool_use_id: e.tool_use_id, description }
    if ('skip' in routed) logTo($, config.logLevel, warned, { ...decided, outcome: 'skip', models: [], reasons: [routed.skip] }, asked)
    else {
      const models = routed.verifier ? [routed.model, routed.verifier] : [routed.model]
      const jev = answers && jevNumbers(answers)
      logTo($, config.logLevel, warned, { ...decided, outcome: fellBack ? 'fallback' : 'routed', models, effort: routed.effort, profile: routed.profile, reasons: routed.reasons, jev, error }, asked)
      route = fellBack ? `fallback (${routed.reasons[0]})` : `${routed.model}·${routed.effort}·${routed.profile.replace(PROFILE_MATCHER, '')}`
    }
    if (route !== undefined || answers) await track($, config, userEffort, (savings) => ({ ...savings, route: route ?? savings.route, jevCalls: savings.jevCalls + (answers ? 1 : 0) }))

    // The engine raises agent.spawn inside this next(); the entry lives only for that call.
    decisions.set(e.tool_use_id, routed)
    const profile = 'skip' in routed ? undefined : routed.profile
    if (profile) dispatching.set(profile, (dispatching.get(profile) ?? 0) + 1)
    try {
      return await next('skip' in routed ? { ...e, description } : { ...e, effort: routed.effort, description })
    } finally {
      if (profile) dispatching.set(profile, dispatching.get(profile)! - 1)
      decisions.delete(e.tool_use_id)
      reserved.delete(e.tool_use_id)
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const routed = decisions.get(e.tool_use_id)
    decisions.delete(e.tool_use_id)
    if (!routed || 'skip' in routed || isOwnSpawn(next.origin.plugin, $.plugin.name, e.subagentType) || e.fork || e.isTeammate || e.workflow) return next(e)

    let spawned: AgentSpawnResult | undefined
    if (registered.has(routed.profile)) {
      try {
        spawned = await next({ ...e, model: routed.model, subagentType: routed.profile })
      } catch {
        // a hook beneath refused the profile: keep the model only
      }
    }
    if (spawned === undefined || spawned.deny !== undefined) spawned = await next({ ...e, model: routed.model })
    reserved.delete(e.tool_use_id)
    if (spawned.agentId !== undefined) {
      active.add(spawned.agentId)
      costed.set(spawned.agentId, { routed: routed.model, parentModel: e.parentModel })
      if (routed.verifier) pendingVerify.set(spawned.agentId, { tool_use_id: e.tool_use_id, prompt: e.prompt, verifier: routed.verifier, description: e.description })
    }
    return spawned
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) return next(e)
    // ponytail: a background agent woken again runs more turns; it is freed and costed at the first turn.complete only; revisit if the host exposes an agent-ended event
    active.delete(e.agentId)
    const cost = costed.get(e.agentId)
    costed.delete(e.agentId)
    const usage = e.usage
    if (cost && usage) await track($, config, userEffort, (savings) => addAgent(savings, usage, cost.routed, cost.parentModel, config.prices, cost.isVerifier))
    const pending = pendingVerify.get(e.agentId)
    pendingVerify.delete(e.agentId)
    if (!pending || e.reason !== 'answer') return next(e)

    // Started unawaited: the primary's answer never waits on its verifier. Its spawn carries this
    // plugin's origin, so both routing hooks pass it through (isOwnSpawn).
    const verify = async ({ tool_use_id, prompt, verifier, description }: Verification, answer: string) => {
      if (!registered.has(VERIFY_PROFILE)) return $.ui.toast(`JEV: verificador não disparado: perfil ${VERIFY_PROFILE} ausente`)
      if (active.size + reserved.size >= config.maxAgents) return $.ui.toast('JEV: verificador não disparado: maxAgents')
      dispatching.set(VERIFY_PROFILE, (dispatching.get(VERIFY_PROFILE) ?? 0) + 1)
      try {
        const spawned = await $.agent.spawn({
          prompt: `${prompt}\n\n--- Answer to review ---\n${answer}\n\n--- Your task ---\n${VERIFY_INSTRUCTION}`,
          model: verifier,
          subagentType: VERIFY_PROFILE,
          description: `verify: ${description}`,
        })
        if (spawned.deny !== undefined) return $.ui.toast(`JEV: verificador recusado: ${spawned.deny}`)
        if (spawned.agentId !== undefined) {
          active.add(spawned.agentId)
          costed.set(spawned.agentId, { routed: verifier, isVerifier: true })
        }
        logTo($, config.logLevel, warned, { tool_use_id, description, outcome: 'verifier', models: [verifier], profile: VERIFY_PROFILE, reasons: [] })
      } finally {
        dispatching.set(VERIFY_PROFILE, dispatching.get(VERIFY_PROFILE)! - 1)
      }
    }
    verify(pending, e.answer).catch((err) => $.ui.toast(`JEV: verificador falhou: ${err instanceof Error ? err.message : String(err)}`))
    return next(e)
  })
}
