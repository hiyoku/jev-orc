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

export function formatStatus(savings: Savings, mode: Mode, jevPricePerCall: number, userEffort: string): string {
  if (mode === 'off') return 'jev OFF'
  const parts = ['jev ON']
  if (savings.route) parts.push(savings.route)
  if (savings.agents > 0) {
    const real = savings.cost + savings.jevCalls * jevPricePerCall
    parts.push(`${abbreviateTokens(savings.tokens)} tok ${usd(real)}`)
    const versus = `vs ${savings.parent}/${userEffort}`
    const estimated = savings.estimated
    if (estimated === null || estimated <= 0) parts.push(versus)
    else {
      const percent = Math.round(((real - estimated) / estimated) * 100)
      parts.push(`${versus} ~${usd(estimated)} (${percent > 0 ? '+' : ''}${percent}%)`)
    }
  }
  return parts.join(' · ')
}
