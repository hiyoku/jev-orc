import { expect, test } from 'claude-code/testing'
import { formatHistory, HISTORY_CAP, HISTORY_SHOWN, recordSession, type HistoryEntry } from './history'
import { EMPTY_SAVINGS } from './savings'

const savings = { ...EMPTY_SAVINGS, agents: 2, tokens: 43_000, cost: 0.12, estimated: 0.45, parent: 'opus' }

test('a session keeps one entry, updated to its latest savings', () => {
  const first = recordSession([], 's1', 1000, savings)
  expect(recordSession(first, 's1', 2000, { ...savings, cost: 0.2 })).toEqual([
    { session: 's1', at: 2000, tokens: 43_000, cost: 0.2, estimated: 0.45, parent: 'opus' },
  ])
})

test('past the cap the oldest session is dropped', () => {
  let history: HistoryEntry[] = []
  for (let i = 0; i <= HISTORY_CAP; i++) history = recordSession(history, `s${i}`, i, savings)
  expect(history.length).toBe(HISTORY_CAP)
  expect(history[0].session).toBe('s1')
})

test('the list shows the newest first, with the saving against the parent', () => {
  const history = [...recordSession([], 'old', 0, savings), { session: 'new', at: Date.UTC(2026, 9, 29, 14, 2), tokens: 900, cost: 0.01, estimated: null, parent: '?' }]
  expect(formatHistory(history)).toEqual(['2026-10-29 14:02 · 900 tok $0.01', '1970-01-01 00:00 · 43k tok $0.12 · vs opus ~$0.45 (-73%)'])
})

test('the list stops at the sessions shown', () => {
  let history: HistoryEntry[] = []
  for (let i = 0; i < HISTORY_SHOWN + 5; i++) history = recordSession(history, `s${i}`, i, savings)
  expect(formatHistory(history).length).toBe(HISTORY_SHOWN)
})
