import type { CoreEngineInterface } from 'claude-code'
import { JEV_TIMEOUT_MS, type Config } from '../config'
import type { JevAnswers } from './answers'
import { questions } from './questions'

export type JevErrorKind = 'missing_key' | 'timeout' | 'network' | 'bad_payload' | `http_${number}`

// Messages are fixed text: never built from the key, headers or response body.
export class JevError extends Error {
  constructor(readonly kind: JevErrorKind) {
    super(`jev: ${kind}`)
  }
}

type JevDollar = Pick<CoreEngineInterface, 'http' | 'env' | 'clock'>

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parse(text: string): JevAnswers {
  let a: unknown
  try { a = (JSON.parse(text) as { answers?: unknown }).answers } catch { throw new JevError('bad_payload') }
  if (!isObj(a)) throw new JevError('bad_payload')
  for (const [k, q] of Object.entries(questions)) {
    const v = a[k]
    const ok = isObj(v) && (q.type === 'score' ? isNum(v.score) && isNum(v.confidence) : isNum(v.noul))
    if (!ok) throw new JevError('bad_payload')
  }
  return a as JevAnswers
}

export async function askJev(
  $: JevDollar,
  task: { tarefa: string; contexto: string },
  config: Pick<Config, 'apiKey' | 'endpoint'>,
): Promise<JevAnswers> {
  const key = config.apiKey || (await $.env.get('TYPESAFE_API_KEY')) || (await $.env.get('JEV_API_KEY'))
  if (!key) throw new JevError('missing_key')

  const req = $.http.fetch(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: { tarefa: task.tarefa, contexto: task.contexto }, questions }),
  }).catch(() => { throw new JevError('network') })
  const timeout = $.clock.sleep(JEV_TIMEOUT_MS).then(() => { throw new JevError('timeout') })
  const res = await Promise.race([req, timeout])
  if (!res.ok) throw new JevError(`http_${res.status}`)
  return parse(res.text)
}
