import { EFFORTS, MODELS, type Config, type Effort, type Model, type Profile } from '../config'
import type { JevAnswers } from '../jev/answers'
import type { ToolGroup } from '../tools/groups'

export type Decision =
  | {
      models: Model[]
      effort: Effort
      toolGroups: ToolGroup[]
      forcedTools?: string[]
      profile: Profile
      reasons: string[]
    }
  | { skip: string }

// ponytail: cortes não calibrados; recalibrar com ≥200 linhas de decisions.jsonl (distribuição de complexity/confidence por modelo escolhido)
const HAIKU_BELOW = 0.75
const SONNET_BELOW = 2.25
const LOW_CONFIDENCE = 0.4
const WEB_RESEARCH_FLOOR = 0.5
const GROUP_THRESHOLD = 0.5
const EDIT_THRESHOLD = 0.3
// ponytail: cortes não calibrados — a verifier only on opus-tier complexity with confidence below this; recalibrar pela distribuição de confidence nas decisões opus de decisions.jsonl (≥200 linhas)
const VERIFY_CONFIDENCE_BELOW = 0.5
// ponytail: cortes não calibrados — deliberation noul abaixo de cada limite dá o effort correspondente; acima do último, max; recalibrar pela distribuição de deliberation em decisions.jsonl (≥200 linhas)
const EFFORT_CUTS: readonly [number, Effort][] = [
  [0.2, 'low'],
  [0.4, 'medium'],
  [0.6, 'high'],
  [0.8, 'xhigh'],
]

const FORCED = 'forced by config'
const GROUP_QUESTIONS = [
  ['edits_files', 'edit'],
  ['runs_shell', 'shell'],
  ['web_research', 'web'],
  ['library_docs', 'docs'],
  ['browser', 'browser'],
] as const

export function decide(answers: JevAnswers | undefined, config: Config): Decision {
  const { force } = config
  const effortFor = (profile: Profile) => (profile === 'explore' ? force.effortExplore : force.effortGeneral) ?? force.effort

  if (!answers) {
    const missing = [
      force.model ? '' : 'model',
      force.agent ? '' : 'agent',
      force.agent && effortFor(force.agent) ? '' : 'effort',
      force.tools ? '' : 'tools',
    ].filter(Boolean)
    if (missing.length > 0) return { skip: `sem resposta do JEV e sem force para: ${missing.join(', ')}` }
  }

  const reasons: string[] = []
  const toolGroups = answers ? groupsOf(answers) : (['read'] as ToolGroup[])
  const writes = toolGroups.includes('edit')

  const profile = force.agent ?? projectProfile(writes, config.agentsTarget)
  if (!profile) return { skip: 'task writes but general is not in agentsTarget' }
  reasons.push(force.agent ? `profile ${profile}: ${FORCED}` : `profile ${profile}: ${writes ? 'writes' : 'read-only'}`)

  const model = force.model ?? projectModel(desiredTier(answers!), config)
  reasons.push(force.model ? `model ${model}: ${FORCED}` : `model ${model}: complexity ${answers!.complexity.score.toFixed(2)}`)

  const forcedEffort = effortFor(profile)
  const effort = forcedEffort ?? projectEffort(desiredEffort(answers!), config.allowed.get(model)!)
  reasons.push(forcedEffort ? `effort ${effort}: ${FORCED}` : `effort ${effort}: deliberation ${answers!.deliberation.noul.toFixed(2)}`)

  if (force.tools) reasons.push(`tools ${force.tools.join(',')}: ${FORCED}`)

  const verifier = answers && !force.model ? verifierFor(model, answers, config) : undefined
  if (verifier) {
    const { score, confidence } = answers!.complexity
    reasons.push(`verifier ${verifier}: complexity ${score.toFixed(2)}, confidence ${confidence.toFixed(2)}`)
  }

  return { models: verifier ? [model, verifier] : [model], effort, toolGroups, ...(force.tools && { forcedTools: force.tools }), profile, reasons }
}

function groupsOf(answers: JevAnswers): ToolGroup[] {
  const groups = GROUP_QUESTIONS.filter(([question, group]) => {
    const { noul } = answers[question]
    return noul >= GROUP_THRESHOLD || (group === 'edit' && noul >= EDIT_THRESHOLD)
  }).map(([, group]) => group)
  return ['read', ...groups]
}

// A writing task never goes to explore.
function projectProfile(writes: boolean, target: Profile[]): Profile | undefined {
  if (writes) return target.includes('general') ? 'general' : undefined
  return target.includes('explore') ? 'explore' : 'general'
}

function desiredTier({ complexity, web_research }: JevAnswers): number {
  let tier = complexity.score < HAIKU_BELOW ? 0 : complexity.score < SONNET_BELOW ? 1 : 2
  if (complexity.confidence < LOW_CONFIDENCE) tier = Math.min(tier + 1, MODELS.length - 1)
  if (web_research.noul >= WEB_RESEARCH_FLOOR) tier = Math.max(tier, 1)
  return tier
}

// Nearest enabled tier above, else nearest below; fallbackOrder only breaks equal-distance ties.
function projectModel(tier: number, config: Config): Model {
  const enabled = MODELS.filter((model) => config.allowed.get(model)!.length > 0)
  const above = enabled.filter((model) => MODELS.indexOf(model) >= tier)
  const pool = above.length > 0 ? above : enabled
  const distance = (model: Model) => Math.abs(MODELS.indexOf(model) - tier)
  const order = (model: Model) => config.fallbackOrder.indexOf(model)
  return [...pool].sort((a, b) => distance(a) - distance(b) || order(a) - order(b))[0]
}

// The strongest enabled model other than the primary, only when the task justifies a second look.
function verifierFor(primary: Model, { complexity }: JevAnswers, config: Config): Model | undefined {
  const justified =
    config.multiModel &&
    config.maxModelsPerTask >= 2 &&
    complexity.score >= SONNET_BELOW &&
    complexity.confidence < VERIFY_CONFIDENCE_BELOW
  if (!justified) return undefined
  return MODELS.filter((model) => model !== primary && config.allowed.get(model)!.length > 0).pop()
}

function desiredEffort({ deliberation }: JevAnswers): Effort {
  return EFFORT_CUTS.find(([limit]) => deliberation.noul < limit)?.[1] ?? 'max'
}

// Highest allowed effort not above the request; if the request is below all, the lowest allowed.
function projectEffort(wanted: Effort, allowed: Effort[]): Effort {
  const rank = (effort: Effort) => EFFORTS.indexOf(effort)
  const sorted = [...allowed].sort((a, b) => rank(a) - rank(b))
  return sorted.filter((effort) => rank(effort) <= rank(wanted)).pop() ?? sorted[0]
}
