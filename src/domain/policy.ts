import { EFFORTS, MODELS, type Config, type Effort, type Model, type Profile } from '../config'
import type { JevAnswers } from '../jev/answers'
import type { ToolGroup } from '../tools/groups'

export type Decision = {
  models: Model[]
  effort: Effort
  toolGroups: ToolGroup[]
  profile: Profile
  reasons: string[]
}

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

const GROUP_QUESTIONS = [
  ['edits_files', 'edit'],
  ['runs_shell', 'shell'],
  ['web_research', 'web'],
  ['library_docs', 'docs'],
  ['browser', 'browser'],
] as const

export function decide(answers: JevAnswers, config: Config): Decision {
  const toolGroups = groupsOf(answers)
  const writes = toolGroups.includes('edit')
  // A writing task never goes to explore.
  const profile: Profile = writes ? 'general' : 'explore'
  const model = projectModel(desiredTier(answers), config)
  const effort = projectEffort(desiredEffort(answers), config.efforts)
  const reasons = [
    `profile ${profile}: ${writes ? 'writes' : 'read-only'}`,
    `model ${model}: complexity ${answers.complexity.score.toFixed(2)}`,
    `effort ${effort}: deliberation ${answers.deliberation.noul.toFixed(2)}`,
  ]

  const verifier = verifierFor(model, answers, config)
  if (verifier) {
    const { score, confidence } = answers.complexity
    reasons.push(`verifier ${verifier}: complexity ${score.toFixed(2)}, confidence ${confidence.toFixed(2)}`)
  }

  return { models: verifier ? [model, verifier] : [model], effort, toolGroups, profile, reasons }
}

function groupsOf(answers: JevAnswers): ToolGroup[] {
  const groups = GROUP_QUESTIONS.filter(([question, group]) => {
    const { noul } = answers[question]
    return noul >= GROUP_THRESHOLD || (group === 'edit' && noul >= EDIT_THRESHOLD)
  }).map(([, group]) => group)
  return ['read', ...groups]
}

function desiredTier({ complexity, web_research }: JevAnswers): number {
  let tier = complexity.score < HAIKU_BELOW ? 0 : complexity.score < SONNET_BELOW ? 1 : 2
  if (complexity.confidence < LOW_CONFIDENCE) tier = Math.min(tier + 1, MODELS.length - 1)
  if (web_research.noul >= WEB_RESEARCH_FLOOR) tier = Math.max(tier, 1)
  return tier
}

// The wanted tier, capped at maxModel.
const projectModel = (tier: number, config: Config): Model => MODELS[Math.min(tier, MODELS.indexOf(config.maxModel))]

// The strongest enabled model other than the primary, only when the task justifies a second look.
function verifierFor(primary: Model, { complexity }: JevAnswers, config: Config): Model | undefined {
  const justified =
    config.multiModel &&
    complexity.score >= SONNET_BELOW &&
    complexity.confidence < VERIFY_CONFIDENCE_BELOW
  if (!justified) return undefined
  return MODELS.slice(0, MODELS.indexOf(config.maxModel) + 1).filter((model) => model !== primary).pop()
}

export function desiredEffort({ deliberation }: JevAnswers): Effort {
  return EFFORT_CUTS.find(([limit]) => deliberation.noul < limit)?.[1] ?? 'max'
}

// Highest allowed effort not above the request; if the request is below all, the lowest allowed.
export function projectEffort(wanted: Effort, allowed: Effort[]): Effort {
  const rank = (effort: Effort) => EFFORTS.indexOf(effort)
  const sorted = [...allowed].sort((a, b) => rank(a) - rank(b))
  return sorted.filter((effort) => rank(effort) <= rank(wanted)).pop() ?? sorted[0]
}
