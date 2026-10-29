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
  // shortcut: set at session.start, which runs once per process, so after a reload (an option change) this stays English; resolve the language in each hook that speaks if that matters.
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
    try {
      await $.state.set({ plugin: 'jev-orchestrator', key: 'mode' } as const, config.mode)
      if (total) await $.state.set({ plugin: 'jev-orchestrator', key: 'total' } as const, total)
    } catch {} // the state copies are for other plugins: the routing does not depend on them
    try {
      // Where the key comes from, in the order askJev looks (src/jev/client.ts), blank as missing; never the key itself.
      const env = {
        TYPESAFE_API_KEY: Boolean((await $.env.get('TYPESAFE_API_KEY'))?.trim()),
        JEV_API_KEY: Boolean((await $.env.get('JEV_API_KEY'))?.trim()),
      }
      const source = config.apiKey ? 'option' : env.TYPESAFE_API_KEY ? 'TYPESAFE_API_KEY' : env.JEV_API_KEY ? 'JEV_API_KEY' : 'none'
      await $.state.set({ plugin: 'jev-orchestrator', key: 'key' } as const, { source, env, endpoint: new URL(config.endpoint).host })
    } catch {} // no env, or an endpoint URL fails to parse: no key entry, mode and total stay
    if (config.showStatus) $.ui.status(formatStatus(value ?? EMPTY_SAVINGS, config.mode, view(total)))
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
    try {
      await $.state.set({ plugin: 'jev-orchestrator', key: 'mode' } as const, action.mode)
    } catch {}
    if (config.showStatus) $.ui.status(formatStatus(savings, action.mode, view(total)))
    return { text: changedMessage(text.s, config.mode, action.mode) }
  })

  routeAgentSpawns(on, config, registered, text)
}
