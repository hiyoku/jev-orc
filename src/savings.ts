import type { Mode, Model, Price } from './config'
import { MODELS } from './config'
import type { Savings } from '../types/index'

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export const EMPTY_SAVINGS: Savings = { agents: 0, tokens: 0, cost: 0, estimated: 0, jevCalls: 0, parent: '?', route: '' }

const PER_MTOK = 1_000_000

// ponytail: haiku's higher rate above 100K prompt tokens is not modelled (usage arrives summed per turn); revisit if the host exposes per-request usage
export const costOf = (usage: Usage, price: Price): number =>
  (usage.input_tokens * price.input +
    usage.output_tokens * price.output +
    usage.cache_read_input_tokens * price.cacheRead +
    usage.cache_creation_input_tokens * price.cacheWrite) /
  PER_MTOK

// "claude-opus-5-5" -> opus; anything else is unknown.
export const familyOf = (modelId: string | undefined): Model | undefined => MODELS.find((model) => modelId?.includes(model))

// A routed agent: its tokens at the routed model's price against the same tokens at the parent's.
// ponytail: the counterfactual does not model how much the effort changes the token count; revisit by measuring tokens per effort level in decisions.jsonl and applying a per-level factor if the gap matters.
// A verifier is extra work the user would not have run: real cost only, no counterfactual.
export function addAgent(
  savings: Savings,
  usage: Usage,
  routed: Model,
  parentModel: string | undefined,
  prices: Record<Model, Price>,
  isVerifier = false,
): Savings {
  const parent = familyOf(parentModel)
  const counterfactual = isVerifier ? 0 : parent ? costOf(usage, prices[parent]) : null
  return {
    ...savings,
    agents: savings.agents + 1,
    tokens: savings.tokens + usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    cost: savings.cost + costOf(usage, prices[routed]),
    estimated: savings.estimated === null || counterfactual === null ? null : savings.estimated + counterfactual,
    parent: isVerifier ? savings.parent : (parent ?? '?'),
  }
}

export const abbreviateTokens = (n: number): string =>
  n < 1000 ? String(n) : n < 999_500 ? `${Math.round(n / 1000)}k` : `${(n / PER_MTOK).toFixed(1)}M`

export const usd = (value: number): string =>
  value > 0 && value < 0.0005 ? '<$0.001' : `$${value > 0 && value < 0.01 ? value.toFixed(3) : value.toFixed(2)}`

// " (-74%)" against the counterfactual; empty when there is none to compare.
function percentVs(real: number, estimated: number | null): string {
  if (estimated === null || estimated <= 0) return ''
  const percent = Math.round(((real - estimated) / estimated) * 100)
  return ` (${percent > 0 ? '+' : ''}${percent}%)`
}

// `total`: every session's savings, kept in $.store; shown from the first routed agent ever.
// `promptEffort`: the effort the main loop's last request ran with, after a dash; hidden while unknown.
export function formatStatus(savings: Savings, mode: Mode, userEffort: string, total?: Savings, promptEffort = '?'): string {
  const effort = promptEffort === '?' ? '' : ` — ${promptEffort}`
  if (mode === 'off') return `jev OFF${effort}`
  const parts = ['jev ON']
  if (savings.route) parts.push(savings.route)
  if (savings.agents > 0) {
    const real = savings.cost
    parts.push(`${abbreviateTokens(savings.tokens)} tok ${usd(real)}`)
    const versus = `vs ${savings.parent}/${userEffort}`
    const estimated = savings.estimated
    parts.push(estimated === null || estimated <= 0 ? versus : `${versus} ~${usd(estimated)}${percentVs(real, estimated)}`)
  }
  if (total && total.agents > 0) {
    const real = total.cost
    parts.push(`total ${usd(real)}${percentVs(real, total.estimated)}`)
  }
  return parts.join(' · ') + effort
}
