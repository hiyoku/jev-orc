import { expect, test } from 'claude-code/testing'
import { PRICES as prices } from './config'
import { abbreviateTokens, addAgent, costOf, EMPTY_SAVINGS, familyOf, formatStatus, usd } from './savings'

const near = (n: number) => Math.round(n * 1e6) / 1e6
const MILLION = { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 }

test('cost per model prices all four token kinds', () => {
  expect(near(costOf(MILLION, prices.haiku))).toBe(near(0.1 + 0.5 + 0.01 + 0.125))
  expect(near(costOf(MILLION, prices.sonnet))).toBe(near(2 + 10 + 0.2 + 2.5))
  expect(near(costOf(MILLION, prices.opus))).toBe(near(4 + 20 + 0.2 + 5))
})

test('model ids map to a family, unknown ids to nothing', () => {
  expect(familyOf('claude-opus-5-5')).toBe('opus')
  expect(familyOf('claude-haiku-5-5')).toBe('haiku')
  expect(familyOf('gpt-x')).toBeUndefined()
  expect(familyOf(undefined)).toBeUndefined()
})

test('the counterfactual prices the same tokens at the parent model', () => {
  const usage = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const s = addAgent(EMPTY_SAVINGS, usage, 'haiku', 'claude-opus-5-5', prices)
  expect(near(s.cost)).toBe(near(0.1))
  expect(near(s.estimated!)).toBe(near(4))
  expect(s.parent).toBe('opus')
  expect(s.tokens).toBe(1e6)
})

test('an unknown parent model leaves no estimate, and it stays unknown', () => {
  const s = addAgent(EMPTY_SAVINGS, MILLION, 'haiku', 'mystery', prices)
  expect(s.estimated).toBeNull()
  expect(addAgent(s, MILLION, 'haiku', 'claude-opus-5-5', prices).estimated).toBeNull()
  expect(formatStatus(s, 'auto', 'high')).toBe('jev ON · 4.0M tok $0.73 · vs ?/high')
})

test('a verifier adds cost and tokens but no counterfactual', () => {
  const usage = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const s = addAgent(addAgent(EMPTY_SAVINGS, usage, 'haiku', 'claude-opus-5-5', prices), usage, 'sonnet', undefined, prices, true)
  expect(near(s.estimated!)).toBe(near(4))
  expect(near(s.cost)).toBe(near(2.1))
  expect(s.parent).toBe('opus')
})

test('status: OFF, ON, ON with the route, and complete', () => {
  expect(formatStatus(EMPTY_SAVINGS, 'off', 'high')).toBe('jev OFF')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', 'high')).toBe('jev ON')
  expect(formatStatus({ ...EMPTY_SAVINGS, route: 'haiku·low·t-read' }, 'explicit', 0, 'high')).toBe('jev ON · haiku·low·t-read')
  const full = { agents: 1, tokens: 42_000, cost: 0.08, estimated: 0.31, jevCalls: 0, parent: 'opus', route: 'haiku·low·t-read' }
  expect(formatStatus(full, 'auto', 'high')).toBe('jev ON · haiku·low·t-read · 42k tok $0.08 · vs opus/high ~$0.31 (-74%)')
})

test('a routed agent dearer than the parent shows +x%', () => {
  const s = { agents: 1, tokens: 1000, cost: 0.4, estimated: 0.1, jevCalls: 0, parent: 'haiku', route: '' }
  expect(formatStatus(s, 'auto', 'low')).toContain('(+300%)')
})

test('the total across sessions shows from a fresh session on', () => {
  const total = { agents: 12, tokens: 900_000, cost: 1.3, estimated: 2, jevCalls: 0, parent: 'opus', route: '' }
  expect(formatStatus(EMPTY_SAVINGS, 'auto', '?', total)).toBe('jev ON · total $1.30 (-35%)')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', '?', { ...total, estimated: null })).toBe('jev ON · total $1.30')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', '?', EMPTY_SAVINGS)).toBe('jev ON')
  expect(formatStatus(EMPTY_SAVINGS, 'off', '?', total)).toBe('jev OFF')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', '?', undefined, 'high')).toBe('jev ON — high')
  expect(formatStatus(EMPTY_SAVINGS, 'off', '?', undefined, 'low')).toBe('jev OFF — low')
})

test('abbreviations and rounding', () => {
  expect(abbreviateTokens(999)).toBe('999')
  expect(abbreviateTokens(42_300)).toBe('42k')
  expect(abbreviateTokens(2_500_000)).toBe('2.5M')
  expect(usd(0.004)).toBe('$0.004')
  expect(usd(0.08)).toBe('$0.08')
  expect(usd(0)).toBe('$0.00')
  expect(usd(0.0004)).toBe('<$0.001')
})
