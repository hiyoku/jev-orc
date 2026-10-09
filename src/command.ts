import type { Mode } from './config'

export const COMMAND_NAME = 'jev-orc'
export const MODE_KEY = 'jev-orchestrator.mode'
export const USAGE = 'uso: /jev-orc [on|off|explicit|status]'

export type JevOrcAction = { kind: 'set'; mode: Mode } | { kind: 'status' } | { kind: 'usage' }

// No argument toggles auto <-> off; explicit goes to off.
export function parseJevOrcArgs(args: string, currentMode: Mode): JevOrcAction {
  switch (args.trim().toLowerCase()) {
    case '': return { kind: 'set', mode: currentMode === 'off' ? 'auto' : 'off' }
    case 'on': return { kind: 'set', mode: 'auto' }
    case 'off': return { kind: 'set', mode: 'off' }
    case 'explicit': return { kind: 'set', mode: 'explicit' }
    case 'status': return { kind: 'status' }
    default: return { kind: 'usage' }
  }
}

const NOTE: Record<Mode, string> = {
  auto: 'roteamento ligado',
  off: 'roteamento desligado; model/effort manuais valem a partir do próximo spawn',
  explicit: 'só spawns marcados com [jev] são roteados',
}

export const changedMessage = (from: Mode, to: Mode) =>
  from === to ? `jev-orc: já está em ${to} (${NOTE[to]})` : `jev-orc: ${from} → ${to} (${NOTE[to]})`
export const statusMessage = (mode: Mode, line: string) => `jev-orc: ${mode} · ${line}`
export const deniedMessage = (reason: string) => `jev-orc: não foi possível mudar o modo (${reason}); nada foi alterado`
export const usageMessage = (arg: string) => `jev-orc: argumento inválido "${arg.trim()}"\n${USAGE}`
