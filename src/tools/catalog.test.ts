import { expect, test } from 'claude-code/testing'
import { matches } from './catalog'

test('a plain pattern matches only the exact name', () => {
  expect(matches('Read', 'Read')).toBe(true)
  expect(matches('Read', 'ReadMore')).toBe(false)
})

test('a trailing * matches by prefix', () => {
  expect(matches('mcp__context7__*', 'mcp__context7__query-docs')).toBe(true)
  expect(matches('mcp__context7__*', 'mcp__other__x')).toBe(false)
})
