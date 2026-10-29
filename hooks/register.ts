import type { Register } from 'claude-code'
import { COMMAND_NAME, changedMessage, deniedMessage, parseJevOrcArgs, statusMessage, usageMessage } from '../src/command'
import { loadConfig } from '../src/config'
import { EMPTY_SAVINGS, TOTAL_KEY, formatStatus } from '../src/savings'
import { createSession, ready, statusView } from '../src/session'
import { routeAgentSpawns } from '../src/hooks/spawn'
import type { Savings } from '../types/index'

export const register: Register = (on, options) => {
  const { config, warnings } = loadConfig(options)
  const session = createSession(config, options, warnings)
  const { text } = session
  const view = (total?: Savings) => statusView(config, total)

  on('session.start', async ($, e, next) => {
    await ready($, session)
    return next(e)
  })

  on('command.run', { command: COMMAND_NAME }, async ($, e) => {
    await ready($, session)
    const action = parseJevOrcArgs(e.args, config.mode)
    const { value } = await $.state.get({ plugin: 'jev-orchestrator', key: 'savings' } as const)
    const savings = value ?? EMPTY_SAVINGS
    const total = (await $.store.get(TOTAL_KEY).catch(() => undefined)) as Savings | undefined
    if (action.kind === 'usage') return { text: usageMessage(text.s, e.args) }
    if (action.kind === 'status') {
      return { text: statusMessage(text.s, config.mode, formatStatus(savings, config.mode, view(total))) }
    }
    try {
      const { deny } = await $.config.set({ key: 'jev-orchestrator.mode', value: action.mode })
      if (deny !== undefined) return { text: deniedMessage(text.s, deny) }
    } catch (error) {
      return { text: deniedMessage(text.s, String(error)) }
    }
    // The new load redraws the line at its first hook; this one shows the change now.
    try {
      await $.state.set({ plugin: 'jev-orchestrator', key: 'mode' } as const, action.mode)
    } catch {}
    if (config.showStatus) $.ui.status(formatStatus(savings, action.mode, view(total)))
    return { text: changedMessage(text.s, config.mode, action.mode) }
  })

  routeAgentSpawns(on, config, session)
}
