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
  const s = addAgent(EMPTY_SAVINGS, usage, 'haiku', 'claude-opus-5-5', prices, 'auto')
  expect(near(s.cost)).toBe(near(0.1))
  expect(near(s.estimated!)).toBe(near(4))
  expect(s.parent).toBe('opus')
  expect(s.tokens).toBe(1e6)
})

test('an unknown parent model leaves no estimate, and it stays unknown', () => {
  const s = addAgent(EMPTY_SAVINGS, MILLION, 'haiku', 'mystery', prices, 'auto')
  expect(s.estimated).toBeNull()
  expect(addAgent(s, MILLION, 'haiku', 'claude-opus-5-5', prices, 'auto').estimated).toBeNull()
  expect(formatStatus(s, 'auto', { userEffort: 'high' })).toBe('jev ON · 4.0M tok $0.73 · vs ?/high')
})

test('a verifier adds cost and tokens but no counterfactual', () => {
  const usage = { input_tokens: 1e6, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const s = addAgent(addAgent(EMPTY_SAVINGS, usage, 'haiku', 'claude-opus-5-5', prices, 'auto'), usage, 'sonnet', undefined, prices, 'auto', true)
  expect(near(s.estimated!)).toBe(near(4))
  expect(near(s.cost)).toBe(near(2.1))
  expect(s.parent).toBe('opus')
})

test('status: OFF, ON, ON with the route, and complete', () => {
  expect(formatStatus(EMPTY_SAVINGS, 'off', { userEffort: 'high' })).toBe('jev OFF')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', { userEffort: 'high' })).toBe('jev ON')
  expect(formatStatus({ ...EMPTY_SAVINGS, route: 'haiku·low·t-read' }, 'explicit', { userEffort: 'high' })).toBe('jev ON · haiku·low·t-read')
  const full = { agents: 1, tokens: 42_000, cost: 0.08, estimated: 0.31, jevCalls: 0, parent: 'opus', route: 'haiku·low·t-read' }
  expect(formatStatus(full, 'auto', { userEffort: 'high' })).toBe('jev ON · haiku·low·t-read · 42k tok $0.08 · vs opus/high ~$0.31 (-74%)')
})

test('a routed agent dearer than the parent shows +x%', () => {
  const s = { agents: 1, tokens: 1000, cost: 0.4, estimated: 0.1, jevCalls: 0, parent: 'haiku', route: '' }
  expect(formatStatus(s, 'auto', { userEffort: 'low' })).toContain('(+300%)')
})

test('the total across sessions shows from a fresh session on', () => {
  const total = { agents: 12, tokens: 900_000, cost: 1.3, estimated: 2, jevCalls: 0, parent: 'opus', route: '' }
  expect(formatStatus(EMPTY_SAVINGS, 'auto', { total })).toBe('jev ON · total $1.30 (-35%)')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', { total: { ...total, estimated: null } })).toBe('jev ON · total $1.30')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', { total: EMPTY_SAVINGS })).toBe('jev ON')
  expect(formatStatus(EMPTY_SAVINGS, 'off', { total })).toBe('jev OFF')
  expect(formatStatus(EMPTY_SAVINGS, 'auto', { promptEffort: 'high' })).toBe('jev ON — high')
  expect(formatStatus(EMPTY_SAVINGS, 'off', { promptEffort: 'low' })).toBe('jev OFF — low')
})

const G = { power: '\uf011', route: '\uf0e7', tokens: '\uf1c0', cost: '\uf0d6', compare: '\uf0ec', total: '\uf1da', effort: '\uf2db' }
const nerdFull = { agents: 1, tokens: 42_000, cost: 0.08, estimated: 0.31, jevCalls: 0, parent: 'opus', route: 'haiku·low·t-read' }
const nerdTotal = { agents: 2, tokens: 1, cost: 1, estimated: 2, jevCalls: 0, parent: 'opus', route: '' }

test('nerd status: icon segments split by a bar', () => {
  expect(formatStatus(nerdFull, 'auto', { userEffort: 'high', total: nerdTotal, promptEffort: 'high', style: 'nerd' })).toBe(
    `${G.power} jev ON │ ${G.route} haiku·low·t-read │ ${G.tokens} 42k tok │ ${G.cost} $0.08 │ ${G.compare} vs opus/high ~$0.31 (-74%) │ ${G.total} total $1.00 (-50%) │ ${G.effort} high`,
  )
  expect(formatStatus(EMPTY_SAVINGS, 'auto', { style: 'nerd' })).toBe(`${G.power} jev ON`)
})

test('nerd status: OFF keeps only the power and effort segments', () => {
  expect(formatStatus(nerdFull, 'off', { total: nerdTotal, promptEffort: 'low', style: 'nerd' })).toBe(`${G.power} jev OFF │ ${G.effort} low`)
  expect(formatStatus(EMPTY_SAVINGS, 'off', { style: 'nerd' })).toBe(`${G.power} jev OFF`)
})

test('nerd status: a fixed compare model is named without the effort', () => {
  expect(formatStatus({ ...nerdFull, parent: 'fable', route: '' }, 'auto', { userEffort: 'high', style: 'nerd', compare: 'fable' })).toBe(
    `${G.power} jev ON │ ${G.tokens} 42k tok │ ${G.cost} $0.08 │ ${G.compare} vs fable ~$0.31 (-74%)`,
  )
  expect(formatStatus(nerdFull, 'auto', { userEffort: 'high', compare: 'fable' })).toContain(' · vs fable ~$0.31')
})

test('nerd status: an unknown effort shows no effort segment, an unknown estimate no price', () => {
  const s = { ...nerdFull, estimated: null }
  expect(formatStatus(s, 'auto', { style: 'nerd' })).toBe(
    `${G.power} jev ON │ ${G.route} haiku·low·t-read │ ${G.tokens} 42k tok │ ${G.cost} $0.08 │ ${G.compare} vs opus/?`,
  )
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

test('fable is priced and recognised', () => {
  expect(familyOf('claude-fable-5-1')).toBe('fable')
  expect(near(costOf(MILLION, prices.fable))).toBe(near(10 + 50 + 0.25 + 12.5))
})

test('a fixed compare model ignores the parent model', () => {
  const sonnet = addAgent(EMPTY_SAVINGS, MILLION, 'haiku', 'claude-opus-5-5', prices, 'sonnet')
  expect(near(sonnet.estimated!)).toBe(near(costOf(MILLION, prices.sonnet)))
  expect(sonnet.parent).toBe('sonnet')
  const fable = addAgent(EMPTY_SAVINGS, MILLION, 'haiku', 'mystery', prices, 'fable')
  expect(near(fable.estimated!)).toBe(near(costOf(MILLION, prices.fable)))
  expect(fable.parent).toBe('fable')
})

test('a verifier has no counterfactual under a fixed compare model either', () => {
  const s = addAgent(EMPTY_SAVINGS, MILLION, 'sonnet', undefined, prices, 'fable', true)
  expect(s.estimated).toBe(0)
  expect(s.parent).toBe('?')
})
