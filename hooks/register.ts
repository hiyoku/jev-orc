import type { Register } from 'claude-code'
import { COMMAND_NAME, changedMessage, deniedMessage, parseJevOrcArgs, statusMessage, usageMessage } from '../src/command'
import { buildProfiles } from '../src/agents/profiles'
import { loadConfig } from '../src/config'
import { STRINGS, formatWarning, resolveLanguage, type Strings } from '../src/i18n'
import { EMPTY_SAVINGS, formatStatus } from '../src/savings'
import { routeAgentSpawns, TOTAL_KEY } from '../src/hooks/spawn'
import type { Savings } from '../types/index'

export const register: Register = (on, options) => {
  const { config, warnings } = loadConfig(options)
  const registered = new Set<string>()
  // The status view the registration shares; the user's effort is not seen here yet.
  const view = (total?: Savings) => ({ total, style: config.statusStyle, compare: config.compareModel })
  // Set at session.start, which runs again on every module reload; English until then.
  const text: { s: Strings } = { s: STRINGS.en }

  on('session.start', async ($, e, next) => {
    // Literal $ calls: the host scan only follows $ within this file.
    let settingsLanguage: unknown
    let locale: string | undefined
    try {
      settingsLanguage = (await $.settings.read()).language
    } catch {} // no settings: the locale decides
    try {
      locale = (await $.env.get('LC_ALL')) || (await $.env.get('LC_MESSAGES')) || (await $.env.get('LANG'))
    } catch {} // no locale: English
    const s = (text.s = STRINGS[resolveLanguage(options.language, settingsLanguage, locale)])
    for (const warning of warnings) $.ui.toast(formatWarning(s, warning))
    const specs = buildProfiles()
    const results = await Promise.allSettled(specs.map((spec) => $.agent.register(spec)))
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') registered.add(result.value.agent)
      else $.ui.toast(s.toastProfile(specs[i].name, String(result.reason)))
    })
    try {
      await $.command.register({
        name: COMMAND_NAME,
        description: s.commandDescription,
        argumentHint: '[on|off|explicit|status]',
        immediate: true,
      })
    } catch {} // the command is a convenience: the routing does not depend on it
    // What the host kept across a module reload; the user's effort is not seen yet.
    const { value } = await $.state.get({ plugin: 'jev-orchestrator', key: 'savings' } as const)
    const total = (await $.store.get(TOTAL_KEY).catch(() => undefined)) as Savings | undefined
    $.ui.status(formatStatus(value ?? EMPTY_SAVINGS, config.mode, view(total)))
    return next(e)
  })

  on('command.run', { command: COMMAND_NAME }, async ($, e) => {
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
    // The reload does not rerun session.start: the line is refreshed here.
    $.ui.status(formatStatus(savings, action.mode, view(total)))
    return { text: changedMessage(text.s, config.mode, action.mode) }
  })

  routeAgentSpawns(on, config, registered, text)
}
