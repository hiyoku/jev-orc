import { expect, test } from 'claude-code/testing'
import { HINT_MAX, hintFor, intercepts, parseHints, swapsProfile } from './scope'

const builtin = { source: 'built-in', description: 'Software architect agent' }
const mine = { source: 'projectSettings', description: 'Reviews Go code' }
const plugin = { source: 'plugin', description: 'Reviews code' }

test('builtin intercepts what the host calls built-in, not a user agent or a plugin one', () => {
  expect(intercepts('builtin', 'Plan', builtin)).toBe(true)
  expect(intercepts('builtin', 'go-code-reviewer', mine)).toBe(false)
  expect(intercepts('builtin', 'feature-dev:code-reviewer', plugin)).toBe(false)
  // a user's agent that shadows a built-in's name is still the user's
  expect(intercepts('builtin', 'Explore', mine)).toBe(false)
})

test('builtin falls back to the known names while the host has not offered the type', () => {
  expect(intercepts('builtin', 'Plan', undefined)).toBe(true)
  expect(intercepts('builtin', 'go-code-reviewer', undefined)).toBe(false)
})

test('all intercepts every type', () => {
  for (const [type, offered] of [['Plan', builtin], ['go-code-reviewer', mine], ['feature-dev:code-reviewer', plugin], ['x', undefined]] as const) {
    expect(intercepts('all', type, offered)).toBe(true)
  }
})

test('only generic agents may trade their type for a tool profile', () => {
  for (const type of ['general-purpose', 'Explore', 'claude']) expect(swapsProfile(type)).toBe(true)
  for (const type of ['Plan', 'claude-code-guide', 'statusline-setup', 'go-code-reviewer']) expect(swapsProfile(type)).toBe(false)
})

test('parseHints reads name=text pairs and drops the malformed ones', () => {
  const hints = parseHints(' Plan = plans, never edits |go=reviews Go|broken|=nothing|empty=')
  expect([...hints]).toEqual([['Plan', 'plans, never edits'], ['go', 'reviews Go']])
  expect(parseHints(undefined).size).toBe(0)
  expect(parseHints('x=' + 'y'.repeat(500)).get('x')).toHaveLength(HINT_MAX)
})

test('hintFor prefers the user hint, then the cut listing line, then nothing', () => {
  expect(hintFor('Plan', builtin, new Map([['Plan', 'mine']]))).toBe('mine')
  expect(hintFor('Plan', { source: 'built-in', description: `a\n  b ${'z'.repeat(300)}` }, new Map())).toHaveLength(HINT_MAX)
  expect(hintFor('Plan', { source: 'built-in', description: 'a\n  b' }, new Map())).toBe('a b')
  expect(hintFor('Plan', undefined, new Map())).toBe('')
})
