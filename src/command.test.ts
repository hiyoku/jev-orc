import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'
import { changedMessage, parseJevOrcArgs, usageMessage } from './command'

test('parse: toggle e argumentos', () => {
  expect(parseJevOrcArgs('', 'auto')).toEqual({ kind: 'set', mode: 'off' })
  expect(parseJevOrcArgs('', 'off')).toEqual({ kind: 'set', mode: 'auto' })
  expect(parseJevOrcArgs(' ', 'explicit')).toEqual({ kind: 'set', mode: 'auto' })
  expect(parseJevOrcArgs('on', 'off')).toEqual({ kind: 'set', mode: 'auto' })
  expect(parseJevOrcArgs('OFF', 'auto')).toEqual({ kind: 'set', mode: 'off' })
  expect(parseJevOrcArgs('explicit', 'auto')).toEqual({ kind: 'set', mode: 'explicit' })
  expect(parseJevOrcArgs('status', 'auto')).toEqual({ kind: 'status' })
  expect(parseJevOrcArgs('banana', 'auto')).toEqual({ kind: 'usage' })
})

test('mensagens', () => {
  expect(changedMessage('auto', 'off')).toBe(
    'jev-orc: auto → off (roteamento desligado; model/effort manuais valem a partir do próximo spawn)',
  )
  expect(changedMessage('off', 'off')).toContain('já está em off')
  expect(usageMessage(' x ')).toContain('uso: /jev-orc')
})

const run = ($: Engine, args: string) => $.command.run({ command: 'jev-orc', args } as never)

// Register real: the test's hooks stand for the host.
async function host($: Engine, on: On, deny?: string) {
  const sets: { key: string; value: unknown }[] = []
  const statuses: (string | undefined)[] = []
  const commands: string[] = []
  mock.env(on, { HOME: '/home/u' })
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
  expect((await run($, 'x')).text).toContain('uso:')
  expect(h.sets).toEqual([])
})

test('/jev-orc: deny não muda a status line', async ($, on) => {
  const h = await host($, on, 'travado')
  const before = h.statuses.length
  expect((await run($, 'off')).text).toContain('travado')
  expect(h.statuses.length).toBe(before)
})
