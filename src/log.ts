import type { LogLevel } from './config'
import type { JevAnswers } from './jev/answers'
import type { JevErrorKind } from './jev/client'
import { questions } from './jev/questions'
import type { JevState } from './jev/state'

// Under HOME: no data directory in the plugin API, and $.store is a key-value JSON, not a file to tail.
export const LOG_PATH = '.claude/jev-orchestrator/decisions.jsonl'
// ponytail: rewrite cost grows with the file; past this the file moves to `.1` (one generation kept)
export const ROTATE_CHARS = 1024 * 1024
const DEBUG_TASK_CHARS = 200

export type LogIo = {
  home: () => Promise<string | undefined>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
}

export type LogEntry = {
  tool_use_id: string
  description: string
  outcome: 'routed' | 'fallback' | 'skip' | 'verifier' | 'main'
  models: string[]
  effort?: string
  profile?: string
  reasons: string[]
  jev?: Record<string, number>
  error?: JevErrorKind
}

const round = (n: number) => Math.round(n * 100) / 100

// The JEV's raw numbers, flat: a score question gives its score, `<name>_confidence` and the chance
// of each level as `<name>_p<level>`.
export const jevNumbers = (answers: JevAnswers): Record<string, number> =>
  Object.fromEntries(
    Object.entries(answers).flatMap(([name, a]) =>
      'score' in a
        ? [[name, round(a.score)], [`${name}_confidence`, round(a.confidence)], ...a.probabilities.map((p, level) => [`${name}_p${level}`, round(p)])]
        : [[name, round(a.noul)]],
    ),
  )

// Inverse of jevNumbers: undefined if any number is missing or not finite.
export function fromJevNumbers(numbers: Record<string, number>): JevAnswers | undefined {
  const out: Record<string, unknown> = {}
  for (const [name, q] of Object.entries(questions)) {
    const levels = q.type === 'score' ? q.criteria.map((_, level) => `${name}_p${level}`) : []
    const keys = q.type === 'score' ? [name, `${name}_confidence`, ...levels] : [name]
    if (!keys.every(k => Number.isFinite(numbers[k]))) return undefined
    out[name] = q.type === 'score'
      ? { score: numbers[name], confidence: numbers[`${name}_confidence`], probabilities: levels.map(k => numbers[k]) }
      : { noul: numbers[name] }
  }
  return out as JevAnswers
}

// At debug, what JEV read, each long text cut to DEBUG_TASK_CHARS.
const shortened = ({ ultima_resposta_do_agente: reply, ...request }: JevState): JevState => ({
  ...request,
  tarefa: request.tarefa.slice(0, DEBUG_TASK_CHARS),
  ...(reply ? { ultima_resposta_do_agente: reply.slice(0, DEBUG_TASK_CHARS) } : {}),
})

// No $ API appends, so a write reads the file and writes it back whole. One queue per module keeps
// parallel spawns from interleaving or losing lines.
// ponytail: two sessions writing at once can still lose a line; a file per session if that matters
let queue: Promise<void> = Promise.resolve()

// Never awaited by the routing: a failure reaches `onError`, never the caller.
export function logDecision(io: LogIo, level: LogLevel, entry: LogEntry, request: JevState | undefined, onError: () => void): void {
  if (level === 'off') return
  const debug = level === 'debug' && request ? { jev_request: shortened(request) } : {}
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry, ...debug })}\n`
  queue = queue.then(() => append(io, line)).catch(onError)
}

async function append(io: LogIo, line: string) {
  const home = await io.home()
  if (!home) throw new Error('HOME unset')
  const path = `${home}/${LOG_PATH}`
  const current = (await io.exists(path)) ? await io.read(path) : ''
  if (current.length + line.length <= ROTATE_CHARS) return io.write(path, current + line)
  await io.write(`${path.replace(/\.jsonl$/, '')}.1.jsonl`, current)
  await io.write(path, line)
}
