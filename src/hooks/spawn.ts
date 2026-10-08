import type { On } from 'claude-code'
import { FALLBACK_PROFILE, PROFILE_MATCHER, profileFor } from '../agents/profiles'
import type { Config, Effort, Model } from '../config'
import { decide } from '../domain/policy'
import type { JevAnswers } from '../jev/answers'
import { askJev, JevError } from '../jev/client'

export const MAX_TASK_CHARS = 4000
const MARKER = /^\[jev\]\s*/
const DEFAULT_TYPE = 'general-purpose'

type JevIo = Parameters<typeof askJev>[0]
type HttpInit = Parameters<JevIo['http']['fetch']>[1]

type Routed = { model: Model; effort: Effort; profile: string; reason?: string } | { skip: string }

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

  on('agent.offer', { agent: PROFILE_MATCHER }, (_$, e) => ({ isOffered: (dispatching.get(e.agent) ?? 0) > 0 }))

  const fallback = (reason: string): Routed => ({
    model: config.fallback.model,
    effort: config.fallback.effort,
    profile: FALLBACK_PROFILE,
    reason,
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const type = e.subagent_type ?? DEFAULT_TYPE
    const marked = MARKER.test(e.description)
    const untouched =
      config.mode === 'off' ||
      (config.mode === 'explicit' && !marked) ||
      type === 'fork' ||
      e.name !== undefined ||
      e.team_name !== undefined ||
      !config.agentsIntercept.includes(type) ||
      next.origin.plugin === $.plugin.name
    if (untouched) return next(e)

    let routed: Routed
    try {
      const forced = decide(undefined, config)
      let answers: JevAnswers | undefined
      if ('skip' in forced) {
        const task = { tarefa: e.prompt.slice(0, MAX_TASK_CHARS), contexto: `${type}: ${e.description}` }
        // The host follows $ only within this file, so askJev gets literal calls, not $ itself.
        const io = {
          env: { get: (name: string) => (name === 'JEV_API_KEY' ? $.env.get('JEV_API_KEY') : $.env.get('TYPESAFE_API_KEY')) },
          http: { fetch: (url: string, init?: HttpInit) => $.http.fetch(url, init) },
          clock: { sleep: (ms: number) => $.clock.sleep(ms) },
        } as JevIo
        answers = await askJev(io, task, config)
      }
      const decision = answers ? decide(answers, config) : forced
      const profile = profileFor(decision, config)
      if ('skip' in decision) routed = decision
      else if (!profile) routed = { skip: `sem perfil para ${decision.toolGroups.join(',')}` }
      else routed = { model: decision.models[0], effort: decision.effort, profile, reason: decision.reasons.join('; ') }
    } catch (err) {
      if (err instanceof JevError && err.kind === 'missing_key' && !warnedMissingKey) {
        warnedMissingKey = true
        $.ui.toast('JEV: TYPESAFE_API_KEY ausente; usando o fallback')
      }
      routed = fallback(err instanceof JevError ? err.kind : String(err))
    }

    // The engine raises agent.spawn inside this next(); the entry lives only for that call.
    decisions.set(e.tool_use_id, routed)
    const description = e.description.replace(MARKER, '')
    const profile = 'skip' in routed ? undefined : routed.profile
    if (profile) dispatching.set(profile, (dispatching.get(profile) ?? 0) + 1)
    try {
      return await next('skip' in routed ? { ...e, description } : { ...e, effort: routed.effort, description })
    } finally {
      if (profile) dispatching.set(profile, dispatching.get(profile)! - 1)
      decisions.delete(e.tool_use_id)
    }
  })

  on('agent.spawn', async (_$, e, next) => {
    const routed = decisions.get(e.tool_use_id)
    decisions.delete(e.tool_use_id)
    if (!routed || 'skip' in routed || e.fork || e.isTeammate || e.workflow) return next(e)

    if (!registered.has(routed.profile)) return next({ ...e, model: routed.model })

    try {
      const spawned = await next({ ...e, model: routed.model, subagentType: routed.profile })
      if (spawned.deny === undefined) return spawned
    } catch {
      // a hook beneath refused the profile: keep the model only
    }
    return next({ ...e, model: routed.model })
  })
}
