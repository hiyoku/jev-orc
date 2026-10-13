import { loadConfig, type Config } from './config'
import { profileFor } from './agents/profiles'
import { decide } from './domain/policy'
import { fromJevNumbers, LOG_PATH, type LogEntry } from './log'

const STATS = ['complexity', 'complexity_confidence', 'deliberation'] as const

export type Change = { tool_use_id: string; before: string; after: string }
export type Replay = {
  routed: number
  models: Record<string, number>
  efforts: Record<string, number>
  stats: Record<(typeof STATS)[number], { min: number; median: number; max: number }>
  changes: Change[]
}

const route = (models: string[], effort: string | undefined, profile: string | undefined) => `${models[0]}·${effort}·${profile}`

// Pure: decide() again over the raw judgments logged by jevNumbers, with the given config.
export function replay(lines: string[], config: Config): Replay {
  const out: Replay = { routed: 0, models: {}, efforts: {}, stats: {} as Replay['stats'], changes: [] }
  const values: Record<string, number[]> = Object.fromEntries(STATS.map((name) => [name, []]))
  for (const line of lines) {
    let entry: LogEntry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const answers = entry.outcome === 'routed' && entry.jev ? fromJevNumbers(entry.jev) : undefined
    if (!answers) continue
    out.routed++
    out.models[entry.models[0]] = (out.models[entry.models[0]] ?? 0) + 1
    out.efforts[entry.effort!] = (out.efforts[entry.effort!] ?? 0) + 1
    for (const name of STATS) values[name].push(entry.jev![name])
    const decision = decide(answers, config)
    const before = route(entry.models, entry.effort, entry.profile)
    const after = route(decision.models, decision.effort, profileFor(decision))
    if (before !== after) out.changes.push({ tool_use_id: entry.tool_use_id, before, after })
  }
  for (const name of STATS) {
    const sorted = values[name].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    out.stats[name] = { min: sorted[0], median, max: sorted[sorted.length - 1] }
  }
  return out
}

if (import.meta.main) {
  // getBuiltinModule, not import: a plugin module may import only relative paths and "claude-code"
  const fs = process.getBuiltinModule('node:fs')
  const path = process.argv[2] ?? `${process.env.HOME}/${LOG_PATH}`
  const r = replay(fs.readFileSync(path, 'utf8').split('\n').filter(Boolean), loadConfig({}).config)
  console.log(`routed lines with valid jev: ${r.routed}`)
  console.log('models:', r.models)
  console.log('efforts:', r.efforts)
  for (const [name, s] of Object.entries(r.stats)) console.log(`${name}: min ${s.min} median ${s.median} max ${s.max}`)
  for (const c of r.changes) console.log(`${c.tool_use_id}: ${c.before} -> ${c.after}`)
  console.log(`changed: ${r.changes.length}`)
}
