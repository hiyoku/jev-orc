import { update, type AgentSpawnResult, type EngineInterface, type On } from 'claude-code'
import { FALLBACK_PROFILE, PROFILE_MATCHER, profileFor } from '../agents/profiles'
import { hintFor, intercepts, swapsProfile, type Offered } from '../agents/scope'
import { EFFORTS, HOOK_BUDGET_MS, JEV_TIMEOUT_MS, MAX_AGENTS, PARALLELISM, PRICES, type Config, type Effort, type LogLevel, type Model } from '../config'
import { decide, desiredEffort, projectEffort } from '../domain/policy'
import type { Strings } from '../i18n'
import type { JevAnswers } from '../jev/answers'
import { askJev, JevError, type JevErrorKind } from '../jev/client'
import { createLimiter } from '../jev/limiter'
import { jevNumbers, logDecision, type LogEntry, type LogIo } from '../log'
import { addAgent, EMPTY_SAVINGS, formatStatus, TOTAL_KEY } from '../savings'
import { ready, type Session } from '../session'
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
// The same total in $.state, where other plugins can read it.
const TOTAL = { plugin: 'jev-orchestrator', key: 'total' } as const

// user: what the main loop's last request asked for (the counterfactual); prompt: what it ran with.
type Efforts = { user: string; prompt: string }

// The same change folds into the session's savings and into the total across sessions.
// The status never reaches the routing: a failed state write leaves the old line.
async function track($: EngineInterface, config: Config, efforts: Efforts, change: (savings: Savings) => Savings) {
  try {
    const savings = await update($, SAVINGS, (value) => change(value ?? EMPTY_SAVINGS))
    // ponytail: read-then-write, two sessions finishing agents at the same instant can drop one; a per-session key summed on read if that matters
    // ponytail: one agent under an unknown parent model nulls the total's estimate for good (addAgent); keep a compared-cost sum if that shows up
    let total: Savings | undefined
    try {
      total = change(((await $.store.get(TOTAL_KEY)) as Savings | undefined) ?? EMPTY_SAVINGS)
      await $.store.set(TOTAL_KEY, total)
      await $.state.set(TOTAL, total)
    } catch {} // no store: the session's line alone
    if (config.showStatus) $.ui.status(formatStatus(savings, config.mode, { userEffort: efforts.user, total, promptEffort: efforts.prompt, style: config.statusStyle, compare: config.compareModel }))
  } catch {}
}

type JevIo = Parameters<typeof askJev>[0]
type HttpInit = Parameters<JevIo['http']['fetch']>[1]

type JevTask = { tarefa: string; contexto: string }

// The host follows $ only within this file, so askJev gets literal calls, not $ itself.
const jevIo = ($: EngineInterface) =>
  ({
    env: { get: (name: string) => (name === 'JEV_API_KEY' ? $.env.get('JEV_API_KEY') : $.env.get('TYPESAFE_API_KEY')) },
    http: { fetch: (url: string, init?: HttpInit) => $.http.fetch(url, init) },
    clock: { sleep: (ms: number) => $.clock.sleep(ms) },
  }) as JevIo

// What JEV reads as the context of a main-loop prompt.
const MAIN_CONTEXT = 'main session prompt: the user talking to the coding agent directly'

// The host follows $ only within this file, so the log gets literal calls, not $ itself.
// A failure toasts once per session (`warned`) and never reaches the routing.
function logTo($: EngineInterface, s: Strings, level: LogLevel, warned: { log: boolean }, entry: LogEntry, request?: JevTask) {
  const io: LogIo = {
    home: () => $.env.get('HOME'),
    exists: (path) => $.fs.exists(path),
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
  }
  logDecision(io, level, entry, request, () => {
    if (warned.log) return
    warned.log = true
    $.ui.toast(s.toastLog)
  })
}

// A spawn this plugin caused, or one already on a profile of it, is never routed again.
export const isOwnSpawn = (originPlugin: string, self: string, type: string) =>
  originPlugin === self || PROFILE_MATCHER.test(type)

type Routed = { model: Model; verifier?: Model; effort: Effort; profile: string; reasons: string[] }
type Verification = { tool_use_id: string; prompt: string; verifier: Model; description: string }

// tool.call (Agent) decides and applies the effort; agent.spawn, correlated by tool_use_id,
// applies model and tool profile. Fail-open: never a deny.
// `session` holds the routed profiles and the language, filled by `ready` once per load: the hooks that read them await it first.
export function routeAgentSpawns(on: On, config: Config, session: Session) {
  const { registered, text } = session
  // What agent.offer said of each type (source and listing line). The host offers agents to the model before it can name one in an Agent call.
  const offered = new Map<string, Offered>()
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
  // The main loop's last request: the effort it asked for and the one it ran with; unknown until one is seen.
  const efforts: Efforts = { user: '?', prompt: '?' }
  // mainEffort: JEV's effort for each main-loop turn, by turnId, until the turn completes.
  const mainEfforts = new Map<string, Effort>()
  // Waiting on the queue is the hook's own time (no $ call is in flight), and the JEV timeout is
  // a $.clock.sleep, paid from the budget too: the wait gets what is left of the budget after them.
  const maxQueueWaitMs = HOOK_BUDGET_MS - JEV_TIMEOUT_MS - QUEUE_MARGIN_MS
  const limiter = createLimiter(PARALLELISM, maxQueueWaitMs)

  const markRouted = (id: string) => {
    routedIds.add(id)
    if (routedIds.size > ROUTED_IDS_CAP) routedIds.delete(routedIds.values().next().value!)
  }

  // mainEffort: one JEV call per typed prompt; the turn waits for it (up to JEV_TIMEOUT_MS).
  // ponytail: no semaphore, the main loop runs one turn at a time
  on('turn.start', async ($, e, next) => {
    await ready($, session)
    if (!config.mainEffort || config.mode !== 'auto' || !e.text.trim()) return next(e)
    const task = { tarefa: e.text.slice(0, MAX_TASK_CHARS), contexto: MAIN_CONTEXT }
    const entry = { tool_use_id: e.turnId, description: e.text.slice(0, 80), models: [] }
    try {
      const answers = await askJev(jevIo($), task, config)
      const effort = desiredEffort(answers)
      mainEfforts.set(e.turnId, effort)
      const reasons = [`effort ${effort}: deliberation ${answers.deliberation.noul.toFixed(2)}`]
      logTo($, text.s, config.logLevel, warned, { ...entry, outcome: 'main', effort, reasons, jev: jevNumbers(answers) }, task)
      await track($, config, efforts, (savings) => ({ ...savings, route: `${text.s.mainRoute}·${effort}`, jevCalls: savings.jevCalls + 1 }))
    } catch (err) {
      // The prompt keeps the user's effort; a missing key toasts once, as for the agents.
      const kind = err instanceof JevError ? err.kind : undefined
      if (kind === 'missing_key' && !warnedMissingKey) {
        warnedMissingKey = true
        $.ui.toast(text.s.toastMissingKey)
      }
      logTo($, text.s, config.logLevel, warned, { ...entry, outcome: 'skip', reasons: [String(kind ?? err)], error: kind }, task)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const wanted = e.agentId === undefined ? mainEfforts.get(e.turnId) : undefined
    // A model without effort keeps none; maxEffort bounds JEV's pick and, unless mode=off, the user's own effort.
    const main = e.agentId === undefined && config.mode !== 'off'
    const target = wanted ?? (main && (EFFORTS as readonly string[]).includes(String(e.effort)) ? (e.effort as Effort) : undefined)
    const effort = target === undefined || e.effort === undefined ? e.effort : projectEffort(target, config.efforts)
    if (e.agentId === undefined && e.effort !== undefined) {
      efforts.user = String(e.effort)
      // The line is redrawn only when the shown effort changes, not on every step.
      if (String(effort) !== efforts.prompt) {
        efforts.prompt = String(effort)
        await track($, config, efforts, (savings) => savings)
      }
    }
    return yield* next(effort === e.effort ? e : { ...e, effort })
  })

  on('agent.offer', { agent: PROFILE_MATCHER }, (_$, e) => ({ isOffered: (dispatching.get(e.agent) ?? 0) > 0 }))

  // Observes only: the offer goes on unchanged.
  on('agent.offer', (_$, e, next) => {
    offered.set(e.agent, { source: e.source, description: e.description })
    return next(e)
  })

  const fallback = (reason: string): Routed => ({
    model: config.fallback.model,
    effort: config.fallback.effort,
    profile: FALLBACK_PROFILE,
    reasons: [reason],
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    await ready($, session)
    const type = e.subagent_type ?? DEFAULT_TYPE
    const marked = MARKER.test(e.description)
    const untouched =
      config.mode === 'off' ||
      (config.mode === 'explicit' && !marked) ||
      type === 'fork' ||
      // ponytail: the tool marks it deprecated and ignored; a teammate shows only at agent.spawn (isTeammate); revisit if the Agent tool exposes a non-deprecated teammate flag
      e.team_name !== undefined ||
      !intercepts(config.agentScope, type, offered.get(type)) ||
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
      if (active.size + reserved.size >= MAX_AGENTS) throw new Error('maxAgents')
      reserved.add(e.tool_use_id)
      if (!(await limiter.acquire((ms, signal) => $.clock.sleep(ms, { signal })))) throw new Error('parallelism')
      const hint = hintFor(type, offered.get(type), config.agentHints)
      const task = { tarefa: e.prompt.slice(0, MAX_TASK_CHARS), contexto: `${type}${hint ? ` (${hint})` : ''}: ${e.description}` }
      asked = task
      try {
        answers = await askJev(jevIo($), task, config)
      } finally {
        limiter.release()
      }
      const decision = decide(answers, config)
      routed = { model: decision.models[0], verifier: decision.models[1], effort: decision.effort, profile: profileFor(decision), reasons: decision.reasons }
    } catch (err) {
      if (err instanceof JevError && err.kind === 'missing_key' && !warnedMissingKey) {
        warnedMissingKey = true
        $.ui.toast(text.s.toastMissingKey)
      }
      if (err instanceof JevError) error = err.kind
      fellBack = true
      routed = fallback(error ?? (err instanceof Error ? err.message : String(err)))
    }

    const description = e.description.replace(MARKER, '')
    const models = routed.verifier ? [routed.model, routed.verifier] : [routed.model]
    const jev = answers && jevNumbers(answers)
    logTo($, text.s, config.logLevel, warned, { tool_use_id: e.tool_use_id, description, outcome: fellBack ? 'fallback' : 'routed', models, effort: routed.effort, profile: routed.profile, reasons: routed.reasons, jev, error }, asked)
    const route = fellBack ? `${text.s.fallback} (${routed.reasons[0]})` : `${routed.model}·${routed.effort}·${routed.profile.replace(PROFILE_MATCHER, '')}`
    await track($, config, efforts, (savings) => ({ ...savings, route, jevCalls: savings.jevCalls + (answers ? 1 : 0) }))

    // The engine raises agent.spawn inside this next(); the entry lives only for that call.
    decisions.set(e.tool_use_id, routed)
    const { profile } = routed
    dispatching.set(profile, (dispatching.get(profile) ?? 0) + 1)
    try {
      return await next({ ...e, effort: routed.effort, description })
    } finally {
      dispatching.set(profile, dispatching.get(profile)! - 1)
      decisions.delete(e.tool_use_id)
      reserved.delete(e.tool_use_id)
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const routed = decisions.get(e.tool_use_id)
    decisions.delete(e.tool_use_id)
    if (!routed || isOwnSpawn(next.origin.plugin, $.plugin.name, e.subagentType) || e.fork || e.isTeammate || e.workflow) return next(e)

    let spawned: AgentSpawnResult | undefined
    // Only a generic agent trades its type for a tool profile; any other keeps its own prompt and tools and gets the model alone.
    if (swapsProfile(e.subagentType, offered.get(e.subagentType)) && registered.has(routed.profile)) {
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
    if (e.agentId === undefined) return (mainEfforts.delete(e.turnId), next(e))
    // ponytail: a background agent woken again runs more turns; it is freed and costed at the first turn.complete only; revisit if the host exposes an agent-ended event
    active.delete(e.agentId)
    const cost = costed.get(e.agentId)
    costed.delete(e.agentId)
    const usage = e.usage
    if (cost && usage) await track($, config, efforts, (savings) => addAgent(savings, usage, cost.routed, cost.parentModel, PRICES, config.compareModel, cost.isVerifier))
    const pending = pendingVerify.get(e.agentId)
    pendingVerify.delete(e.agentId)
    if (!pending || e.reason !== 'answer') return next(e)

    // Started unawaited: the primary's answer never waits on its verifier. Its spawn carries this
    // plugin's origin, so both routing hooks pass it through (isOwnSpawn).
    const verify = async ({ tool_use_id, prompt, verifier, description }: Verification, answer: string) => {
      if (!registered.has(VERIFY_PROFILE)) return $.ui.toast(text.s.toastVerifierProfile(VERIFY_PROFILE))
      if (active.size + reserved.size >= MAX_AGENTS) return $.ui.toast(text.s.toastVerifierMax)
      dispatching.set(VERIFY_PROFILE, (dispatching.get(VERIFY_PROFILE) ?? 0) + 1)
      try {
        const spawned = await $.agent.spawn({
          prompt: `${prompt}\n\n--- Answer to review ---\n${answer}\n\n--- Your task ---\n${VERIFY_INSTRUCTION}`,
          model: verifier,
          subagentType: VERIFY_PROFILE,
          description: `verify: ${description}`,
        })
        if (spawned.deny !== undefined) return $.ui.toast(text.s.toastVerifierDenied(spawned.deny))
        if (spawned.agentId !== undefined) {
          active.add(spawned.agentId)
          costed.set(spawned.agentId, { routed: verifier, isVerifier: true })
        }
        logTo($, text.s, config.logLevel, warned, { tool_use_id, description, outcome: 'verifier', models: [verifier], profile: VERIFY_PROFILE, reasons: [] })
      } finally {
        dispatching.set(VERIFY_PROFILE, dispatching.get(VERIFY_PROFILE)! - 1)
      }
    }
    verify(pending, e.answer).catch((err) => $.ui.toast(text.s.toastVerifierFailed(err instanceof Error ? err.message : String(err))))
    return next(e)
  })
}
