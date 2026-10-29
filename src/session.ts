import type { EngineInterface, PluginOptions } from 'claude-code'
import { buildProfiles } from './agents/profiles'
import { COMMAND_NAME } from './command'
import type { Config } from './config'
import { STRINGS, formatWarning, resolveLanguage, type Strings, type Warning } from './i18n'
import { EMPTY_SAVINGS, TOTAL_KEY, formatStatus } from './savings'
import type { Savings } from '../types/index'

// What one load of the plugin sets up once and shares with its hooks.
export type Session = {
  config: Config
  options: PluginOptions
  warnings: readonly Warning[]
  // The profiles whose registration succeeded; any other gets the model only.
  registered: Set<string>
  // English until the setup resolves the language.
  text: { s: Strings }
  // plugin.json's version, read by the setup: $.plugin carries only the name and the root.
  version?: string
  loaded?: Promise<void>
}

export function createSession(config: Config, options: PluginOptions, warnings: readonly Warning[]): Session {
  return { config, options, warnings, registered: new Set(), text: { s: STRINGS.en } }
}

// The status view the hooks share; the user's effort is not seen here yet.
export const statusView = (config: Config, total?: Savings) => ({ total, style: config.statusStyle, compare: config.compareModel })

// session.start runs once per process, and a reload (an option change) runs register again without it:
// the first hook of each load runs the setup, once.
export function ready($: EngineInterface, session: Session): Promise<void> {
  return (session.loaded ??= setUp($, session))
}

async function setUp($: EngineInterface, session: Session): Promise<void> {
  const { config, options, warnings, registered, text } = session
  try {
    const { version } = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    if (typeof version === 'string') session.version = version
  } catch {} // no manifest: the log goes without the version
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
  const value = await $.state.get({ plugin: 'jev-orchestrator', key: 'savings' } as const).then((held) => held?.value, () => undefined)
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
  // Off: clear a line an earlier load drew, which a reload leaves on screen.
  $.ui.status(config.showStatus ? formatStatus(value ?? EMPTY_SAVINGS, config.mode, statusView(config, total)) : undefined)
}
