import type { Register } from 'claude-code'
import { COMMAND_NAME, changedMessage, deniedMessage, parseJevOrcArgs, statusMessage, usageMessage } from '../src/command'
import { buildProfiles } from '../src/agents/profiles'
import { loadConfig } from '../src/config'
import { EMPTY_SAVINGS, formatStatus } from '../src/savings'
import { routeAgentSpawns } from '../src/hooks/spawn'

export const register: Register = (on, options) => {
  const { config, warnings } = loadConfig(options)
  const registered = new Set<string>()

  on('session.start', async ($, e, next) => {
    for (const warning of warnings) $.ui.toast(`JEV: ${warning}`)
    const specs = buildProfiles(config)
    const results = await Promise.allSettled(specs.map((spec) => $.agent.register(spec)))
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') registered.add(result.value.agent)
      else $.ui.toast(`JEV: perfil ${specs[i].name} não registrado: ${String(result.reason)}`)
    })
    try {
      await $.command.register({
        name: COMMAND_NAME,
        description: 'Liga/desliga o roteamento do JEV (on, off, explicit, status)',
        argumentHint: '[on|off|explicit|status]',
        immediate: true,
      })
    } catch {} // the command is a convenience: the routing does not depend on it
    // What the host kept across a module reload; the user's effort is not seen yet.
    const { value } = await $.state.get({ plugin: 'jev-orchestrator', key: 'savings' } as const)
    $.ui.status(formatStatus(value ?? EMPTY_SAVINGS, config.mode, config.jevPricePerCall, '?'))
    return next(e)
  })

  on('command.run', { command: COMMAND_NAME }, async ($, e) => {
    const action = parseJevOrcArgs(e.args, config.mode)
    const { value } = await $.state.get({ plugin: 'jev-orchestrator', key: 'savings' } as const)
    const savings = value ?? EMPTY_SAVINGS
    if (action.kind === 'usage') return { text: usageMessage(e.args) }
    if (action.kind === 'status') {
      return { text: statusMessage(config.mode, formatStatus(savings, config.mode, config.jevPricePerCall, '?')) }
    }
    try {
      const { deny } = await $.config.set({ key: 'jev-orchestrator.mode', value: action.mode })
      if (deny !== undefined) return { text: deniedMessage(deny) }
    } catch (error) {
      return { text: deniedMessage(String(error)) }
    }
    // The reload does not rerun session.start: the line is refreshed here.
    $.ui.status(formatStatus(savings, action.mode, config.jevPricePerCall, '?'))
    return { text: changedMessage(config.mode, action.mode) }
  })

  routeAgentSpawns(on, config, registered)
}
