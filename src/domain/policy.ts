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

// ponytail: cortes não calibrados; recalibrar com ≥200 linhas de decisions.jsonl (distribuição de complexity_p0 e complexity_p3 por modelo escolhido)
// Chance of the mechanical complexity level (0) from which haiku is enough.
const HAIKU_FROM = 0.6
// Chance of the open-design complexity level (3) from which the task goes to opus.
const OPUS_FROM = 0.4
const WEB_RESEARCH_FLOOR = 0.5
// ponytail: corte não calibrado — opus com a chance do nível 3 abaixo deste valor ainda está em dúvida, e um verificador revisa; recalibrar pela distribuição de complexity_p3 nas decisões opus de decisions.jsonl (≥200 linhas)
const VERIFY_BELOW = 0.7

// ponytail: cortes não calibrados; faltar uma tool custa um agent perdido, sobrar uma custa quase nada → shell/edit mais baixos; recalibrar com o replay (docs/dev/known-limits.md)
const GROUP_THRESHOLDS = { edit: 0.3, shell: 0.3, web: 0.5, docs: 0.5, browser: 0.5 } as const satisfies Record<
  Exclude<ToolGroup, 'read'>,
  number
>

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
  const [mechanical, , , open] = answers.complexity.probabilities
  const reasons = [
    `profile ${profile}: ${writes ? 'writes' : 'read-only'}`,
    `model ${model}: complexity p0 ${mechanical.toFixed(2)}, p3 ${open.toFixed(2)}`,
    `effort ${effort}: deliberation ${answers.deliberation.score.toFixed(2)}`,
  ]

  const verifier = verifierFor(model, answers, config)
  if (verifier) reasons.push(`verifier ${verifier}: complexity p3 ${open.toFixed(2)}`)

  return { models: verifier ? [model, verifier] : [model], effort, toolGroups, profile, reasons }
}

function groupsOf(answers: JevAnswers): ToolGroup[] {
  const groups = GROUP_QUESTIONS.filter(([question, group]) => {
    return answers[question].noul >= GROUP_THRESHOLDS[group]
  }).map(([, group]) => group)
  return ['read', ...groups]
}

// By the chance of the open level first, then of the mechanical one: the average score hides a split
// between them.
function desiredTier({ complexity, web_research }: JevAnswers): number {
  const [mechanical, , , open] = complexity.probabilities
  let tier = open >= OPUS_FROM ? 2 : mechanical >= HAIKU_FROM ? 0 : 1
  if (web_research.noul >= WEB_RESEARCH_FLOOR) tier = Math.max(tier, 1)
  return tier
}

// The wanted tier, capped at maxModel.
const projectModel = (tier: number, config: Config): Model => MODELS[Math.min(tier, MODELS.indexOf(config.maxModel))]

// The strongest enabled model other than the primary, only when the open level is likely but unsettled.
function verifierFor(primary: Model, { complexity }: JevAnswers, config: Config): Model | undefined {
  const open = complexity.probabilities[3]
  const justified = config.multiModel && open >= OPUS_FROM && open < VERIFY_BELOW
  if (!justified) return undefined
  return MODELS.slice(0, MODELS.indexOf(config.maxModel) + 1).filter((model) => model !== primary).pop()
}

// The nearest deliberation level is the effort: level 0 is low, level 4 is max.
export function desiredEffort({ deliberation }: JevAnswers): Effort {
  return EFFORTS[Math.min(Math.max(Math.round(deliberation.score), 0), EFFORTS.length - 1)]
}

// Highest allowed effort not above the request; if the request is below all, the lowest allowed.
export function projectEffort(wanted: Effort, allowed: Effort[]): Effort {
  const rank = (effort: Effort) => EFFORTS.indexOf(effort)
  const sorted = [...allowed].sort((a, b) => rank(a) - rank(b))
  return sorted.filter((effort) => rank(effort) <= rank(wanted)).pop() ?? sorted[0]
}
