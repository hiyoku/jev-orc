import type { Savings } from '../types/index'
import { abbreviateTokens, percentVs, usd } from './savings'

// The $.store key of each session's savings, the least recently updated first.
export const HISTORY_KEY = 'savingsHistory'
// One entry is about 120 bytes of JSON; the store holds 4 MiB in all.
export const HISTORY_CAP = 200
// The sessions `/jev-orc history` lists.
export const HISTORY_SHOWN = 10

// One session's savings, kept after the session ends.
export type HistoryEntry = Pick<Savings, 'tokens' | 'cost' | 'estimated' | 'parent'> & { session: string; at: number }

// The session's entry replaced by its latest savings, the oldest dropped past the cap.
export function recordSession(history: readonly HistoryEntry[], session: string, at: number, savings: Savings): HistoryEntry[] {
  const { tokens, cost, estimated, parent } = savings
  return [...history.filter((held) => held.session !== session), { session, at, tokens, cost, estimated, parent }].slice(-HISTORY_CAP)
}

// shortcut: the time is UTC, the host gives no time zone; format it local if that confuses
const minuteOf = (at: number): string => new Date(at).toISOString().slice(0, 16).replace('T', ' ')

// The status line's plain words, one session a line, the newest first.
export const formatHistory = (history: readonly HistoryEntry[]): string[] =>
  history
    .slice(-HISTORY_SHOWN)
    .reverse()
    .map(({ at, tokens, cost, estimated, parent }) => {
      const versus = estimated === null || estimated <= 0 ? '' : ` · vs ${parent} ~${usd(estimated)}${percentVs(cost, estimated)}`
      return `${minuteOf(at)} · ${abbreviateTokens(tokens)} tok ${usd(cost)}${versus}`
    })
