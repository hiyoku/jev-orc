import { expect, test } from 'claude-code/testing'
import { LOG_PATH, logDecision, ROTATE_CHARS, type LogEntry, type LogIo } from './log'

const HOME = '/home/u'
const PATH = `${HOME}/${LOG_PATH}`
const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
const settle = async () => { for (let i = 0; i < 20; i++) await tick() }

function memory() {
  const files = new Map<string, string>()
  const io: LogIo = {
    home: async () => HOME,
    exists: async (path) => files.has(path),
    read: async (path) => (await tick(), files.get(path)!),
    write: async (path, text) => void files.set(path, text),
  }
  const lines = () => (files.get(PATH) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { files, io, lines }
}

const entry = (id: string): LogEntry => ({ tool_use_id: id, description: 'read file', outcome: 'routed', models: ['haiku'], effort: 'low', profile: 'jev-orchestrator:t-read', reasons: ['r'] })
const TASK = { tarefa: 'x'.repeat(500), contexto: 'general-purpose: read file' }

test('a well-formed JSONL line per call', async () => {
  const m = memory()
  logDecision(m.io, 'info', entry('t1'), TASK, () => {})
  await settle()
  const [line] = m.lines()
  expect(m.lines()).toHaveLength(1)
  expect(line).toMatchObject(entry('t1'))
  expect(Number.isNaN(Date.parse(line.ts))).toBe(false)
  expect(line.jev_request).toBeUndefined()
})

test('off writes nothing', async () => {
  const m = memory()
  logDecision(m.io, 'off', entry('t1'), TASK, () => {})
  await settle()
  expect(m.files.size).toBe(0)
})

test('debug adds the JEV request with the task cut to 200 chars', async () => {
  const m = memory()
  logDecision(m.io, 'debug', entry('t1'), TASK, () => {})
  await settle()
  expect(m.lines()[0].jev_request).toEqual({ tarefa: 'x'.repeat(200), contexto: TASK.contexto })
})

test('10 parallel writes keep 10 whole lines', async () => {
  const m = memory()
  for (let i = 0; i < 10; i++) logDecision(m.io, 'info', entry(`p${i}`), undefined, () => {})
  await settle()
  expect(m.lines().map((l) => l.tool_use_id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}`))
})

test('past the cap the file rotates to .1', async () => {
  const m = memory()
  m.files.set(PATH, `${'y'.repeat(ROTATE_CHARS - 10)}\n`)
  logDecision(m.io, 'info', entry('new'), undefined, () => {})
  await settle()
  expect(m.files.get(`${HOME}/.claude/jev-orchestrator/decisions.1.jsonl`)).toHaveLength(ROTATE_CHARS - 9)
  expect(m.lines().map((l) => l.tool_use_id)).toEqual(['new'])
})

test('a failing write reaches onError and the queue goes on', async () => {
  const m = memory()
  let errors = 0
  const broken = { ...m.io, write: async () => { throw new Error('EACCES') } }
  logDecision(broken, 'info', entry('bad'), undefined, () => errors++)
  logDecision(m.io, 'info', entry('ok'), undefined, () => errors++)
  await settle()
  expect(errors).toBe(1)
  expect(m.lines().map((l) => l.tool_use_id)).toEqual(['ok'])
})
