import type { CoreEngineInterface } from 'claude-code'
import { JEV_TIMEOUT_MS, type Config } from '../config'
import type { JevAnswers } from './answers'
import { questions } from './questions'
import type { JevState } from './state'

export type JevErrorKind = 'missing_key' | 'timeout' | 'network' | 'bad_payload' | `http_${number}`

// Messages are fixed text: never built from the key, headers or response body.
export class JevError extends Error {
  constructor(readonly kind: JevErrorKind) {
    super(`jev: ${kind}`)
  }
}

type JevDollar = Pick<CoreEngineInterface, 'http' | 'env' | 'clock'>

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function parse(text: string): JevAnswers {
  let a: unknown
  try { a = (JSON.parse(text) as { answers?: unknown }).answers } catch { throw new JevError('bad_payload') }
  if (!isObj(a)) throw new JevError('bad_payload')
  const out: Record<string, unknown> = {}
  for (const [k, q] of Object.entries(questions)) {
    const v = a[k]
    if (!isObj(v)) throw new JevError('bad_payload')
    if (q.type === 'noul') {
      if (!isNum(v.noul)) throw new JevError('bad_payload')
      out[k] = { noul: v.noul }
      continue
    }
    // The API keys each level's probability by its index as a string: "0", "1", ...
    const byLevel = isObj(v.probabilities) ? v.probabilities : {}
    const probabilities = q.criteria.map((_, level) => byLevel[level])
    if (!isNum(v.score) || !isNum(v.confidence) || !probabilities.every(isNum)) throw new JevError('bad_payload')
    out[k] = { score: v.score, confidence: v.confidence, probabilities }
  }
  return out as JevAnswers
}

export async function askJev(
  $: JevDollar,
  state: JevState,
  config: Pick<Config, 'apiKey' | 'endpoint'>,
): Promise<JevAnswers> {
  const key = config.apiKey || (await $.env.get('TYPESAFE_API_KEY'))?.trim() || (await $.env.get('JEV_API_KEY'))?.trim()
  if (!key) throw new JevError('missing_key')

  const req = $.http.fetch(config.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  }).catch(() => { throw new JevError('network') })
  const timeout = $.clock.sleep(JEV_TIMEOUT_MS).then(() => { throw new JevError('timeout') })
  const res = await Promise.race([req, timeout])
  if (!res.ok) throw new JevError(`http_${res.status}`)
  return parse(res.text)
}
