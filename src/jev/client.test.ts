import { expect, test } from 'claude-code/testing'
import { loadConfig } from '../config'
import { askJev, JevError } from './client'
import { questions } from './questions'

const config = loadConfig({}).config
const task = { tarefa: 'rename x', contexto: 'general-purpose: rename' }
const KEY = 'sk-secret-123'
// The API's shape: a score's probabilities keyed by level index.
const good = {
  answers: {
    complexity: { score: 0.5, confidence: 0.9, probabilities: { 0: 0.5, 1: 0.5, 2: 0, 3: 0 } },
    deliberation: { score: 0, confidence: 1, probabilities: { 0: 1, 1: 0, 2: 0, 3: 0, 4: 0 } }, edits_files: { noul: 0.9 }, runs_shell: { noul: 0 },
    web_research: { noul: 0 }, library_docs: { noul: 0 }, browser: { noul: 0 },
  },
}
// What askJev returns for `good`: each score's probabilities as an array, by level.
const parsed = {
  ...good.answers,
  complexity: { score: 0.5, confidence: 0.9, probabilities: [0.5, 0.5, 0, 0] },
  deliberation: { score: 0, confidence: 1, probabilities: [1, 0, 0, 0, 0] },
}

// Plain fake `$`: the host refuses `$.env/http/clock` calls from modules that the plugin's
// hooks don't import (it scans for them), so askJev is tested through a structural fake.
// The "clock" is manual: sleep() resolves only when the test calls tick().
function setup(env: Record<string, string>, res: () => Promise<unknown> | unknown, cfg = config) {
  const calls: { url: string; init?: { headers?: Record<string, string>; body?: string; method?: string } }[] = []
  const sleeps: (() => void)[] = []
  const $ = {
    env: { get: async (name: string) => env[name] },
    http: {
      fetch: async (url: string, init?: never) => {
        calls.push({ url, init })
        const r = (await res()) as { status: number; text: string }
        return { status: r.status, ok: r.status < 300, headers: {}, text: r.text }
      },
    },
    clock: { sleep: (_ms: number) => new Promise<void>((r) => { sleeps.push(r) }) },
  } as unknown as Parameters<typeof askJev>[0]
  const run = async () => {
    try { return { ok: await askJev($, task, cfg) } } catch (e) { return { err: e as JevError } }
  }
  return { run, calls, tick: () => sleeps.forEach((r) => r()) }
}

test('the fixture answers match the questions', () => {
  expect(Object.keys(good.answers)).toEqual(Object.keys(questions))
})

test('success: posts body and bearer header, returns answers', async () => {
  const { run, calls } = setup({ TYPESAFE_API_KEY: KEY }, () => ({ status: 200, text: JSON.stringify(good) }))
  expect((await run()).ok).toEqual(parsed)
  expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone')
  expect(calls[0].init?.method).toBe('POST')
  expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${KEY}`)
  const body = JSON.parse(calls[0].init?.body ?? '')
  expect(body.model).toBe('jev-latest')
  expect(body.state).toEqual(task)
  expect(Object.keys(body.questions).length).toBe(7)
})

test('OpenRouter: the configured endpoint gets the same body and the option key', async () => {
  const cfg = loadConfig({ jevEndpoint: 'https://openrouter.ai/api/v1/systemone', typesafeApiKey: 'fake-openrouter-key' }).config
  const { run, calls } = setup({}, () => ({ status: 200, text: JSON.stringify(good) }), cfg)
  expect((await run()).ok).toEqual(parsed)
  expect(calls[0].url).toBe('https://openrouter.ai/api/v1/systemone')
  expect(calls[0].init?.headers?.Authorization).toBe('Bearer fake-openrouter-key')
  expect(JSON.parse(calls[0].init?.body ?? '').model).toBe('jev-latest')
})

test('JEV_API_KEY works as fallback', async () => {
  const { run, calls } = setup({ JEV_API_KEY: KEY }, () => ({ status: 200, text: JSON.stringify(good) }))
  await run()
  expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${KEY}`)
})

test('the key option wins over both variables', async () => {
  const cfg = loadConfig({ typesafeApiKey: 'fake-option-key' }).config
  const { run, calls } = setup({ TYPESAFE_API_KEY: KEY, JEV_API_KEY: KEY }, () => ({ status: 200, text: JSON.stringify(good) }), cfg)
  await run()
  expect(calls[0].init?.headers?.Authorization).toBe('Bearer fake-option-key')
})

test('a blank key option counts as unset', async () => {
  for (const blank of ['', '  \t ']) {
    const loaded = loadConfig({ typesafeApiKey: blank })
    expect(loaded.config.apiKey).toBeUndefined()
    const { run, calls } = setup({ TYPESAFE_API_KEY: KEY }, () => ({ status: 200, text: JSON.stringify(good) }), loaded.config)
    await run()
    expect(calls[0].init?.headers?.Authorization).toBe(`Bearer ${KEY}`)
  }
})

test('blank key variables count as unset, a padded one is trimmed', async () => {
  const padded = setup({ TYPESAFE_API_KEY: '  \t ', JEV_API_KEY: ` ${KEY} ` }, () => ({ status: 200, text: JSON.stringify(good) }))
  await padded.run()
  expect(padded.calls[0].init?.headers?.Authorization).toBe(`Bearer ${KEY}`)
  const none = setup({ TYPESAFE_API_KEY: ' ', JEV_API_KEY: '' }, () => ({ status: 200, text: '' }))
  expect((await none.run()).err?.kind).toBe('missing_key')
  expect(none.calls.length).toBe(0)
})

test('the key option never reaches the config warnings', () => {
  expect(loadConfig({ typesafeApiKey: 'fake-option-key', mode: 'bogus' }).warnings.join('\n').includes('fake-option-key')).toBe(false)
})

test('missing key', async () => {
  const { run, calls } = setup({}, () => ({ status: 200, text: '' }))
  expect((await run()).err?.kind).toBe('missing_key')
  expect(calls.length).toBe(0)
})

test('timeout when fetch outlasts JEV_TIMEOUT_MS', async () => {
  const s = setup({ TYPESAFE_API_KEY: KEY }, () => new Promise(() => {}))
  const p = s.run()
  await Promise.resolve(); await Promise.resolve()
  s.tick()
  expect((await p).err?.kind).toBe('timeout')
})

test('HTTP 500', async () => {
  const { run } = setup({ TYPESAFE_API_KEY: KEY }, () => ({ status: 500, text: 'boom' }))
  expect((await run()).err?.kind).toBe('http_500')
})

test('malformed payloads are bad_payload', async () => {
  const bodies = ['not json', '{}', JSON.stringify({ answers: { ...good.answers, browser: { noul: 'x' } } }),
    JSON.stringify({ answers: { ...good.answers, complexity: { score: 1 } } }),
    JSON.stringify({ answers: { ...good.answers, complexity: { score: 1, confidence: 0.9, probabilities: { 0: 1 } } } })]
  let i = 0
  const { run } = setup({ TYPESAFE_API_KEY: KEY }, () => ({ status: 200, text: bodies[i] }))
  for (; i < bodies.length; i++) expect((await run()).err?.kind).toBe('bad_payload')
})

test('the key never appears in an error message', async () => {
  let status = 500
  const { run } = setup({ TYPESAFE_API_KEY: KEY }, () => ({ status, text: `echo ${KEY}` }))
  for (status of [500, 403, 200]) {
    const e = (await run()).err
    expect(e?.message.includes(KEY)).toBe(false)
  }
})
