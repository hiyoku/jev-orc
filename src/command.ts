import type { Mode } from './config'
import type { Strings } from './i18n'

export const COMMAND_NAME = 'jev-orc'
export const MODE_KEY = 'jev-orchestrator.mode'

export type JevOrcAction = { kind: 'set'; mode: Mode } | { kind: 'status' } | { kind: 'history' } | { kind: 'usage' }

// No argument toggles auto <-> off; explicit goes to off.
export function parseJevOrcArgs(args: string, currentMode: Mode): JevOrcAction {
  switch (args.trim().toLowerCase()) {
    case '': return { kind: 'set', mode: currentMode === 'off' ? 'auto' : 'off' }
    case 'on': return { kind: 'set', mode: 'auto' }
    case 'off': return { kind: 'set', mode: 'off' }
    case 'explicit': return { kind: 'set', mode: 'explicit' }
    case 'status': return { kind: 'status' }
    case 'history': return { kind: 'history' }
    default: return { kind: 'usage' }
  }
}

export const changedMessage = (s: Strings, from: Mode, to: Mode) => s.changed(from, to, s.modeNote[to])
export const statusMessage = (s: Strings, mode: Mode, line: string) => s.status(mode, line)
export const historyMessage = (s: Strings, lines: readonly string[]) => (lines.length ? [s.historyTitle, ...lines].join('\n') : s.historyEmpty)
export const deniedMessage = (s: Strings, reason: string) => s.denied(reason)
export const usageMessage = (s: Strings, arg: string) => `${s.invalidArg(arg.trim())}\n${s.usage}`
