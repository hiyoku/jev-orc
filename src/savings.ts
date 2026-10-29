import type { CompareModel, Mode, Model, PricedModel, Price, StatusStyle } from './config'
import { PRICED_MODELS } from './config'
import type { Savings } from '../types/index'

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const EMPTY_SAVINGS: Savings = { agents: 0, tokens: 0, cost: 0, estimated: 0, jevCalls: 0, parent: '?', route: '' }
// The $.store key of every session's savings summed.
export const TOTAL_KEY = 'totalSavings'

const PER_MTOK = 1_000_000

// ponytail: haiku's higher rate above 100K prompt tokens is not modelled (usage arrives summed per turn); revisit if the host exposes per-request usage
export const costOf = (usage: Usage, price: Price): number =>
  (usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_read_input_tokens * price.cacheRead +
    usage.cache_creation_input_tokens * price.cacheWrite) /
  PER_MTOK

// "claude-opus-5-5" -> opus; anything else is unknown.
export const familyOf = (modelId: string | undefined): PricedModel | undefined => PRICED_MODELS.find((model) => modelId?.includes(model))

// A routed agent: its tokens at the routed model's price against the same tokens at the parent's.
// ponytail: the counterfactual does not model how much the effort changes the token count; revisit by measuring tokens per effort level in decisions.jsonl and applying a per-level factor if the gap matters.
// A verifier is extra work the user would not have run: real cost only, no counterfactual.
export function addAgent(
  savings: Savings,
  usage: Usage,
  routed: Model,
  parentModel: string | undefined,
  prices: Record<PricedModel, Price>,
  compare: CompareModel,
  isVerifier = false,
): Savings {
  const reference = compare === 'auto' ? familyOf(parentModel) : compare
  const counterfactual = isVerifier ? 0 : reference ? costOf(usage, prices[reference]) : null
  return {
    ...savings,
    agents: savings.agents + 1,
    tokens: savings.tokens + usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    cost: savings.cost + costOf(usage, prices[routed]),
    estimated: savings.estimated === null || counterfactual === null ? null : savings.estimated + counterfactual,
    parent: isVerifier ? savings.parent : (reference ?? '?'),
  }
}

export const abbreviateTokens = (n: number): string =>
  n < 1000 ? String(n) : n < 999_500 ? `${Math.round(n / 1000)}k` : `${(n / PER_MTOK).toFixed(1)}M`

export const usd = (value: number): string =>
  value > 0 && value < 0.0005 ? '<$0.001' : `$${value > 0 && value < 0.01 ? value.toFixed(3) : value.toFixed(2)}`

// " (-74%)" against the counterfactual; empty when there is none to compare.
export function percentVs(real: number, estimated: number | null): string {
  if (estimated === null || estimated <= 0) return ''
  const percent = Math.round(((real - estimated) / estimated) * 100)
  return ` (${percent > 0 ? '+' : ''}${percent}%)`
}

// Font Awesome glyphs of the Nerd Fonts, as escapes: the source never carries the characters.
const NERD = { power: '\uf011', route: '\uf0e7', tokens: '\uf1c0', cost: '\uf0d6', compare: '\uf0ec', total: '\uf1da', effort: '\uf2db' } as const

// `userEffort`: the effort the main loop's last request asked for (the counterfactual's), `?` while unknown.
// `total`: every session's savings, kept in $.store; shown from the first routed agent ever.
// `promptEffort`: the effort the main loop's last request ran with; hidden while unknown.
// `style`: plain is text with dots and a dash; nerd is icon segments split by a bar.
// `compare`: auto names the session's model with its effort; a fixed model names itself only.
export type StatusView = { userEffort?: string; total?: Savings; promptEffort?: string; style?: StatusStyle; compare?: CompareModel }

export function formatStatus(savings: Savings, mode: Mode, view: StatusView = {}): string {
  const { userEffort = '?', total, promptEffort = '?', style = 'plain', compare = 'auto' } = view
  const nerd = style === 'nerd'
  // [icon, text]: plain drops the icon and the segments are joined below.
  const parts: [keyof typeof NERD, string][] = [['power', mode === 'off' ? 'jev OFF' : 'jev ON']]
  if (mode !== 'off') {
    if (savings.route) parts.push(['route', savings.route])
    if (savings.agents > 0) {
      const real = savings.cost
      const tokens = `${abbreviateTokens(savings.tokens)} tok`
      if (nerd) parts.push(['tokens', tokens], ['cost', usd(real)])
      else parts.push(['tokens', `${tokens} ${usd(real)}`])
      const versus = `vs ${compare === 'auto' ? `${savings.parent}/${userEffort}` : compare}`
      const estimated = savings.estimated
      parts.push(['compare', estimated === null || estimated <= 0 ? versus : `${versus} ~${usd(estimated)}${percentVs(real, estimated)}`])
    }
    if (total && total.agents > 0) parts.push(['total', `total ${usd(total.cost)}${percentVs(total.cost, total.estimated)}`])
  }
  if (promptEffort !== '?' && nerd) parts.push(['effort', promptEffort])
  const plainEffort = promptEffort === '?' ? '' : ` — ${promptEffort}`
  return nerd ? parts.map(([icon, text]) => `${NERD[icon]} ${text}`).join(' │ ') : parts.map(([, text]) => text).join(' · ') + plainEffort
}
