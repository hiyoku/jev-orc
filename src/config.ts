import type { HookBudget, PluginOptions } from 'claude-code'
import { warning, type Warning } from './i18n'
import { SCOPES, parseHints, type Scope } from './agents/scope'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const MODELS = ['haiku', 'sonnet', 'opus'] as const
export const PROFILES = ['explore', 'general'] as const
export const PRICED_MODELS = [...MODELS, 'fable'] as const
export const COMPARE_MODELS = ['auto', ...PRICED_MODELS] as const
export const STATUS_STYLES = ['nerd', 'plain'] as const
const MODES = ['auto', 'off', 'explicit'] as const
const LOG_LEVELS = ['off', 'info', 'debug'] as const

export const HOOK_BUDGET_MS: HookBudget['ms'] = 10_000

export type Effort = (typeof EFFORTS)[number]
export type Model = (typeof MODELS)[number]
export type Profile = (typeof PROFILES)[number]
export type PricedModel = (typeof PRICED_MODELS)[number]
export type CompareModel = (typeof COMPARE_MODELS)[number]
export type StatusStyle = (typeof STATUS_STYLES)[number]
export type Mode = (typeof MODES)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]

export type Config = {
  mode: Mode
  maxModel: Model
  maxEffort: Effort
  // Every effort up to maxEffort, low first.
  efforts: Effort[]
  fallback: { model: Model; effort: Effort; agent: string }
  multiModel: boolean
  // JEV sets the effort of the user's own prompts; the session model stays.
  mainEffort: boolean
  // Secret: never put in warnings, toasts, logs or the status line.
  apiKey?: string
  // System One API: TypeSafe's, or OpenRouter's (https://openrouter.ai/api/v1/systemone) with an OpenRouter key.
  endpoint: string
  logLevel: LogLevel
  // Model the status line prices the routed tokens against; auto: the session's own model.
  compareModel: CompareModel
  // nerd: Nerd Font icons; plain: text only.
  statusStyle: StatusStyle
  // Which agents the routing touches: builtin (Claude Code's own) or all (plus .claude/agents and plugins').
  agentScope: Scope
  // Per-agent text JEV reads beside the name; the host's listing line when none.
  agentHints: Map<string, string>
}

// US$ per MTok.
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type LoadedConfig = { config: Config; warnings: Warning[] }

// Fixed internals: once options, now the values almost nobody changed.
export const MAX_AGENTS = 8
export const PARALLELISM = 4
export const JEV_TIMEOUT_MS = 8000
// ponytail: list prices; an option again if someone has negotiated prices
// Anthropic's published prices for the current family (-5-5), US$ per MTok; cache write is the
// 5-minute TTL (1.25x input) and haiku's cache read is the documented 0.1x of its input.
// fable: claude-api skill (2026-10); its cacheWrite is derived (1.25x input), not listed there.
export const PRICES: Record<PricedModel, Price> = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  fable: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
}
const FALLBACK = { model: 'sonnet', effort: 'medium', agent: 'general-purpose' } as const

const DEFAULTS = {
  mode: 'auto',
  endpoint: 'https://api.typesafe.ai/v1/systemone',
  maxModel: 'opus',
  maxEffort: 'xhigh',
  multiModel: false,
  mainEffort: false,
  logLevel: 'info',
  compareModel: 'auto',
  statusStyle: 'nerd',
  agentScope: 'builtin',
} as const

// The lower of two values on an ordered scale.
const atMost = <T>(scale: readonly T[], value: T, max: T): T => scale[Math.min(scale.indexOf(value), scale.indexOf(max))]

export function loadConfig(options: PluginOptions): LoadedConfig {
  const warnings: Warning[] = []
  const oneOf = <T extends string>(field: string, valid: readonly T[], fallback: T): T => {
    const value = options[field]
    if (value === undefined) return fallback
    if ((valid as readonly unknown[]).includes(value)) return value as T
    warnings.push(warning('invalid', field, String(value), fallback))
    return fallback
  }
  const boolean = (field: string, fallback: boolean) => (typeof options[field] === 'boolean' ? (options[field] as boolean) : fallback)

  const maxModel = oneOf('maxModel', MODELS, DEFAULTS.maxModel)
  const maxEffort = oneOf('maxEffort', EFFORTS, DEFAULTS.maxEffort)
  const key = options.typesafeApiKey
  // The key goes to this URL: https only, never plain http.
  const endpoint = typeof options.jevEndpoint === 'string' ? options.jevEndpoint.trim() : ''
  const isHttps = /^https:\/\/\S+$/.test(endpoint)
  if (endpoint && !isHttps) warnings.push(warning('invalid', 'jevEndpoint', endpoint, DEFAULTS.endpoint))
  const config: Config = {
    mode: oneOf('mode', MODES, DEFAULTS.mode),
    maxModel,
    maxEffort,
    efforts: EFFORTS.slice(0, EFFORTS.indexOf(maxEffort) + 1),
    fallback: { model: atMost(MODELS, FALLBACK.model, maxModel), effort: atMost(EFFORTS, FALLBACK.effort, maxEffort), agent: FALLBACK.agent },
    multiModel: boolean('multiModel', DEFAULTS.multiModel),
    mainEffort: boolean('mainEffort', DEFAULTS.mainEffort),
    apiKey: (typeof key === 'string' && key.trim()) || undefined,
    endpoint: isHttps ? endpoint : DEFAULTS.endpoint,
    logLevel: oneOf('logLevel', LOG_LEVELS, DEFAULTS.logLevel),
    compareModel: oneOf('compareModel', COMPARE_MODELS, DEFAULTS.compareModel),
    statusStyle: oneOf('statusStyle', STATUS_STYLES, DEFAULTS.statusStyle),
    agentScope: oneOf('agentScope', SCOPES, DEFAULTS.agentScope),
    agentHints: parseHints(options.agentHints),
  }
  return { config, warnings }
}
