import type { PluginOptions } from 'claude-code'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const MODELS = ['haiku', 'sonnet', 'opus'] as const
export const PROFILES = ['explore', 'general'] as const
const MODES = ['auto', 'off', 'explicit'] as const
const LOG_LEVELS = ['off', 'info', 'debug'] as const

export type Effort = (typeof EFFORTS)[number]
export type Model = (typeof MODELS)[number]
export type Profile = (typeof PROFILES)[number]
export type Mode = (typeof MODES)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]

export type Config = {
  mode: Mode
  allowed: Map<Model, Effort[]>
  fallbackOrder: Model[]
  agentsIntercept: string[]
  agentsTarget: Profile[]
  force: {
    model?: Model
    effort?: Effort
    effortExplore?: Effort
    effortGeneral?: Effort
    agent?: Profile
    tools?: string[]
  }
  fallback: { model: Model; effort: Effort; agent: string }
  multiModel: boolean
  maxModelsPerTask: number
  maxAgents: number
  parallelism: number
  toolsAllow: string[]
  toolsDeny: string[]
  jevTimeoutMs: number
  jevEndpoint: string
  logLevel: LogLevel
}

export type LoadedConfig = { config: Config; warnings: string[] }

const DEFAULTS = {
  mode: 'auto',
  effortsHaiku: ['low', 'medium'],
  effortsSonnet: ['low', 'medium', 'high'],
  effortsOpus: ['medium', 'high', 'xhigh'],
  fallbackOrder: ['sonnet', 'opus', 'haiku'],
  agentsIntercept: ['general-purpose', 'Explore'],
  agentsTarget: ['explore', 'general'],
  fallbackModel: 'sonnet',
  fallbackEffort: 'medium',
  fallbackAgent: 'general-purpose',
  multiModel: false,
  maxModelsPerTask: 1,
  maxAgents: 8,
  parallelism: 4,
  jevTimeoutMs: 15000,
  jevEndpoint: 'https://api.typesafe.ai/v1/systemone',
  logLevel: 'info',
} as const

// "jev" is the picker's "no override" value (an empty option is not allowed in userConfig).
const NOT_FORCED = ['', 'jev']

export function loadConfig(options: PluginOptions): LoadedConfig {
  const warnings: string[] = []
  const read = new OptionReader(options, warnings)

  const mode = read.oneOf('mode', MODES, DEFAULTS.mode)
  const allowed = new Map<Model, Effort[]>([
    ['haiku', read.efforts('effortsHaiku', DEFAULTS.effortsHaiku)],
    ['sonnet', read.efforts('effortsSonnet', DEFAULTS.effortsSonnet)],
    ['opus', read.efforts('effortsOpus', DEFAULTS.effortsOpus)],
  ])
  const enabledModels = MODELS.filter((model) => allowed.get(model)!.length > 0)
  const agentsTarget = read.listOf('agentsTarget', PROFILES, DEFAULTS.agentsTarget)
  const fallbackOrder = read.listOf('fallbackOrder', MODELS, DEFAULTS.fallbackOrder)
  const toolsDeny = read.strings('toolsDeny', [])

  const config: Config = {
    mode,
    allowed,
    fallbackOrder,
    agentsIntercept: read.strings('agentsIntercept', DEFAULTS.agentsIntercept),
    agentsTarget,
    force: readForce(read, allowed, enabledModels, agentsTarget, toolsDeny, warnings),
    fallback: projectFallback(read, allowed, enabledModels, fallbackOrder),
    multiModel: read.boolean('multiModel', DEFAULTS.multiModel),
    maxModelsPerTask: read.positiveInt('maxModelsPerTask', DEFAULTS.maxModelsPerTask),
    maxAgents: read.positiveInt('maxAgents', DEFAULTS.maxAgents),
    parallelism: read.positiveInt('parallelism', DEFAULTS.parallelism),
    toolsAllow: read.strings('toolsAllow', []),
    toolsDeny,
    jevTimeoutMs: read.positiveInt('jevTimeoutMs', DEFAULTS.jevTimeoutMs),
    jevEndpoint: read.string('jevEndpoint', DEFAULTS.jevEndpoint),
    logLevel: read.oneOf('logLevel', LOG_LEVELS, DEFAULTS.logLevel),
  }

  if (enabledModels.length === 0) {
    config.mode = 'off'
    warnings.push('nenhum modelo habilitado (todas as listas efforts* vazias): mode=off')
  } else if (agentsTarget.length === 0) {
    config.mode = 'off'
    warnings.push('agentsTarget vazio: mode=off')
  }

  return { config, warnings }
}

function readForce(
  read: OptionReader,
  allowed: Map<Model, Effort[]>,
  enabledModels: Model[],
  agentsTarget: Profile[],
  toolsDeny: string[],
  warnings: string[],
): Config['force'] {
  const allowedEfforts = EFFORTS.filter((effort) => enabledModels.some((model) => allowed.get(model)!.includes(effort)))
  const forced = <T extends string>(field: string, space: readonly T[], spaceName: string): T | undefined => {
    const value = read.oneOf(field, [...NOT_FORCED, ...EFFORTS, ...MODELS, ...PROFILES], '')
    if (NOT_FORCED.includes(value)) return undefined
    if ((space as readonly string[]).includes(value)) return value as T
    warnings.push(`${field}=${value} fora de ${spaceName}: ignorado, o JEV decide`)
    return undefined
  }

  const tools = read.strings('forceTools', [])
  const deniedTools = tools.filter((tool) => toolsDeny.includes(tool))
  if (deniedTools.length > 0) warnings.push(`forceTools contém tools em toolsDeny (removidas): ${deniedTools.join(', ')}`)
  const permittedTools = tools.filter((tool) => !toolsDeny.includes(tool))

  return {
    model: forced('forceModel', enabledModels, 'modelos habilitados'),
    effort: forced('forceEffort', allowedEfforts, 'efforts*'),
    effortExplore: forced('forceEffortExplore', allowedEfforts, 'efforts*'),
    effortGeneral: forced('forceEffortGeneral', allowedEfforts, 'efforts*'),
    agent: forced('forceAgent', agentsTarget, 'agentsTarget'),
    tools: permittedTools.length > 0 ? permittedTools : undefined,
  }
}

function projectFallback(
  read: OptionReader,
  allowed: Map<Model, Effort[]>,
  enabledModels: Model[],
  fallbackOrder: Model[],
): Config['fallback'] {
  const requested = read.oneOf('fallbackModel', MODELS, DEFAULTS.fallbackModel)
  const effort = read.oneOf('fallbackEffort', EFFORTS, DEFAULTS.fallbackEffort)
  const agent = read.string('fallbackAgent', DEFAULTS.fallbackAgent)
  const model = enabledModels.includes(requested)
    ? requested
    : (fallbackOrder.find((candidate) => enabledModels.includes(candidate)) ?? enabledModels[0] ?? requested)

  const modelEfforts = allowed.get(model)!
  if (modelEfforts.length === 0 || modelEfforts.includes(effort)) return { model, effort, agent }

  const rank = (e: Effort) => EFFORTS.indexOf(e)
  const below = modelEfforts.filter((e) => rank(e) < rank(effort))
  return { model, effort: below.length > 0 ? below[below.length - 1] : modelEfforts[0], agent }
}

class OptionReader {
  constructor(
    private readonly options: PluginOptions,
    private readonly warnings: string[],
  ) {}

  oneOf<T extends string>(field: string, valid: readonly T[], fallback: T): T {
    const value = this.options[field]
    if (value === undefined) return fallback
    if ((valid as readonly unknown[]).includes(value)) return value as T
    this.warnings.push(`${field}=${String(value)} inválido: usando ${fallback}`)
    return fallback
  }

  string(field: string, fallback: string): string {
    const value = this.options[field]
    return typeof value === 'string' && value !== '' ? value : fallback
  }

  boolean(field: string, fallback: boolean): boolean {
    const value = this.options[field]
    return typeof value === 'boolean' ? value : fallback
  }

  positiveInt(field: string, fallback: number): number {
    const value = this.options[field]
    if (value === undefined) return fallback
    if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value
    this.warnings.push(`${field}=${String(value)} inválido (inteiro >= 1): usando ${fallback}`)
    return fallback
  }

  strings(field: string, fallback: readonly string[]): string[] {
    const value = this.options[field]
    return Array.isArray(value) ? [...value] : [...fallback]
  }

  listOf<T extends string>(field: string, valid: readonly T[], fallback: readonly T[]): T[] {
    const kept: T[] = []
    for (const item of this.strings(field, fallback)) {
      if ((valid as readonly string[]).includes(item)) kept.push(item as T)
      else this.warnings.push(`${field}: valor desconhecido "${item}" descartado`)
    }
    return kept
  }

  efforts(field: string, fallback: readonly Effort[]): Effort[] {
    return this.listOf(field, EFFORTS, fallback)
  }
}
