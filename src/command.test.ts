import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'
import { STRINGS } from './i18n'
import { changedMessage, parseJevOrcArgs, usageMessage } from './command'

test('parse: toggle e argumentos', () => {
  expect(parseJevOrcArgs('', 'auto')).toEqual({ kind: 'set', mode: 'off' })
  expect(parseJevOrcArgs('', 'off')).toEqual({ kind: 'set', mode: 'auto' })
  expect(parseJevOrcArgs(' ', 'explicit')).toEqual({ kind: 'set', mode: 'off' })
  expect(parseJevOrcArgs('on', 'off')).toEqual({ kind: 'set', mode: 'auto' })
  expect(parseJevOrcArgs('OFF', 'auto')).toEqual({ kind: 'set', mode: 'off' })
  expect(parseJevOrcArgs('explicit', 'auto')).toEqual({ kind: 'set', mode: 'explicit' })
  expect(parseJevOrcArgs('status', 'auto')).toEqual({ kind: 'status' })
  expect(parseJevOrcArgs('banana', 'auto')).toEqual({ kind: 'usage' })
})

const en = STRINGS.en
const pt = STRINGS['pt-BR']

test('messages, in both languages', () => {
  expect(changedMessage(en, 'auto', 'off')).toBe('jev-orc: auto → off (routing off; manual model/effort apply from the next spawn)')
  expect(changedMessage(pt, 'auto', 'off')).toBe('jev-orc: auto → off (roteamento desligado; model/effort manuais valem a partir do próximo spawn)')
  expect(changedMessage(en, 'off', 'off')).toContain('already off')
  expect(changedMessage(pt, 'off', 'off')).toContain('já está em off')
  expect(usageMessage(en, ' x ')).toContain('usage: /jev-orc')
  expect(usageMessage(pt, ' x ')).toContain('uso: /jev-orc')
})

const run = ($: Engine, args: string) => $.command.run({ command: 'jev-orc', args } as never)

// Register real: the test's hooks stand for the host.
async function host($: Engine, on: On, deny?: string, env: Record<string, string> = {}) {
  const sets: { key: string; value: unknown }[] = []
  const statuses: (string | undefined)[] = []
  const commands: string[] = []
  mock.env(on, { HOME: '/home/u', ...env })
  on('session.start', (_, e) => e)
  on('agent.register', (_, spec) => ({ value: { agent: `jev-orchestrator:${spec.name}` } }))
  on('command.register', (_, spec) => (commands.push(spec.name), { value: undefined } as never))
  on('state.get', () => ({ value: { value: undefined, version: 0 } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', (_, e) => (statuses.push(e.text), { value: undefined }))
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })
    return deny ? { deny } : { value: e.value }
  })
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  return { sets, statuses, commands }
}

test('/jev-orc: registra, alterna e atualiza a status line', async ($, on) => {
  const h = await host($, on)
  expect(h.commands).toEqual(['jev-orc'])
  const r = await run($, '')
  expect(r.text).toContain('auto → off')
  expect(h.sets).toEqual([{ key: 'jev-orchestrator.mode', value: 'off' }])
  expect(h.statuses.at(-1)).toBe('jev OFF')
})

test('/jev-orc status e inválido não gravam', async ($, on) => {
  const h = await host($, on)
  expect((await run($, 'status')).text).toContain('jev ON')
  expect((await run($, 'x')).text).toContain('usage:')
  expect(h.sets).toEqual([])
})

test('/jev-orc: deny não muda a status line', async ($, on) => {
  const h = await host($, on, 'locked')
  const before = h.statuses.length
  expect((await run($, 'off')).text).toContain('locked')
  expect(h.statuses.length).toBe(before)
})

test('/jev-orc answers in pt-BR when the locale is Portuguese', async ($, on) => {
  await host($, on, undefined, { LANG: 'pt_BR.UTF-8' })
  expect((await run($, 'x')).text).toContain('uso:')
  expect((await run($, 'off')).text).toContain('roteamento desligado')
})

test('the language option wins over the locale', { options: { language: 'en' } }, async ($, on) => {
  await host($, on, undefined, { LANG: 'pt_BR.UTF-8' })
  expect((await run($, 'x')).text).toContain('usage:')
})
