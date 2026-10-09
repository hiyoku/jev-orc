// Pure: everything the user reads, in English and pt-BR. Model names, `jev ON/OFF`, the JSONL log
// and the profile prompts are not here on purpose (stable formats, not prose).
export type Lang = 'en' | 'pt-BR'

const isPortuguese = (v: unknown): boolean => typeof v === 'string' && /^(pt|portug)/i.test(v.trim())

// An explicit option wins; in `auto`, Claude Code's `language` setting, then the process locale.
export function resolveLanguage(option: unknown, settingsLanguage: unknown, locale: unknown): Lang {
  if (option === 'en' || option === 'pt-BR') return option
  const fromSettings = typeof settingsLanguage === 'string' && settingsLanguage.trim() !== ''
  return isPortuguese(fromSettings ? settingsLanguage : locale) ? 'pt-BR' : 'en'
}

// A config warning is a code plus arguments, so loadConfig stays pure and the language is
// applied only where the toast is shown.
export type Warning = { code: keyof typeof STRINGS.en.warn; args: string[] }
export const warning = (code: Warning['code'], ...args: string[]): Warning => ({ code, args })

type Mode = 'auto' | 'off' | 'explicit'
const SPACES = {
  en: { models: 'enabled models', efforts: 'efforts*', agentsTarget: 'agentsTarget' },
  'pt-BR': { models: 'modelos habilitados', efforts: 'efforts*', agentsTarget: 'agentsTarget' },
}

export const STRINGS = {
  en: {
    fallback: 'fallback',
    commandDescription: 'Turns JEV routing on/off (on, off, explicit, status)',
    usage: 'usage: /jev-orc [on|off|explicit|status]',
    invalidArg: (arg: string) => `jev-orc: invalid argument "${arg}"`,
    modeNote: {
      auto: 'routing on',
      off: 'routing off; manual model/effort apply from the next spawn',
      explicit: 'only spawns marked with [jev] are routed',
    } as Record<Mode, string>,
    changed: (from: Mode, to: Mode, note: string) => (from === to ? `jev-orc: already ${to} (${note})` : `jev-orc: ${from} → ${to} (${note})`),
    status: (mode: Mode, line: string) => `jev-orc: ${mode} · ${line}`,
    denied: (reason: string) => `jev-orc: could not change the mode (${reason}); nothing was changed`,
    toastProfile: (name: string, reason: string) => `JEV: profile ${name} not registered: ${reason}`,
    toastMissingKey:
      'JEV: key missing, using the fallback; set the key in /plugin → Installed → jev-orchestrator → Configure options, or in TYPESAFE_API_KEY',
    toastLog: 'JEV: failed to write the decision log',
    toastVerifierProfile: (profile: string) => `JEV: verifier not started: profile ${profile} missing`,
    toastVerifierMax: 'JEV: verifier not started: maxAgents',
    toastVerifierDenied: (deny: string) => `JEV: verifier refused: ${deny}`,
    toastVerifierFailed: (msg: string) => `JEV: verifier failed: ${msg}`,
    warn: {
      invalid: (f: string, v: string, fb: string) => `${f}=${v} invalid: using ${fb}`,
      invalidInt: (f: string, v: string, range: string, fb: string) => `${f}=${v} invalid (integer ${range}): using ${fb}`,
      invalidNumber: (f: string, v: string, fb: string) => `${f}=${v} invalid (number >= 0): using ${fb}`,
      invalidPrice: (f: string, v: string) => `${f}=${v} invalid (input,output,cacheRead,cacheWrite in US$/MTok): using the default`,
      unknownItem: (f: string, item: string) => `${f}: unknown value "${item}" dropped`,
      outOfSpace: (f: string, v: string, space: string) => `${f}=${v} outside ${SPACES.en[space as keyof typeof SPACES.en]}: ignored, JEV decides`,
      deniedTools: (tools: string) => `forceTools contains tools in toolsDeny (removed): ${tools}`,
      noModels: () => 'no model enabled (all efforts* lists empty): mode=off',
      noTarget: () => 'agentsTarget empty: mode=off',
    },
  },
  'pt-BR': {
    fallback: 'fallback',
    commandDescription: 'Liga/desliga o roteamento do JEV (on, off, explicit, status)',
    usage: 'uso: /jev-orc [on|off|explicit|status]',
    invalidArg: (arg: string) => `jev-orc: argumento inválido "${arg}"`,
    modeNote: {
      auto: 'roteamento ligado',
      off: 'roteamento desligado; model/effort manuais valem a partir do próximo spawn',
      explicit: 'só spawns marcados com [jev] são roteados',
    } as Record<Mode, string>,
    changed: (from: Mode, to: Mode, note: string) => (from === to ? `jev-orc: já está em ${to} (${note})` : `jev-orc: ${from} → ${to} (${note})`),
    status: (mode: Mode, line: string) => `jev-orc: ${mode} · ${line}`,
    denied: (reason: string) => `jev-orc: não foi possível mudar o modo (${reason}); nada foi alterado`,
    toastProfile: (name: string, reason: string) => `JEV: perfil ${name} não registrado: ${reason}`,
    toastMissingKey:
      'JEV: chave ausente, usando o fallback; defina a chave em /plugin → Installed → jev-orchestrator → Configure options, ou em TYPESAFE_API_KEY',
    toastLog: 'JEV: falha ao gravar o log de decisões',
    toastVerifierProfile: (profile: string) => `JEV: verificador não disparado: perfil ${profile} ausente`,
    toastVerifierMax: 'JEV: verificador não disparado: maxAgents',
    toastVerifierDenied: (deny: string) => `JEV: verificador recusado: ${deny}`,
    toastVerifierFailed: (msg: string) => `JEV: verificador falhou: ${msg}`,
    warn: {
      invalid: (f: string, v: string, fb: string) => `${f}=${v} inválido: usando ${fb}`,
      invalidInt: (f: string, v: string, range: string, fb: string) => `${f}=${v} inválido (inteiro ${range}): usando ${fb}`,
      invalidNumber: (f: string, v: string, fb: string) => `${f}=${v} inválido (número >= 0): usando ${fb}`,
      invalidPrice: (f: string, v: string) => `${f}=${v} inválido (input,output,cacheRead,cacheWrite em US$/MTok): usando o default`,
      unknownItem: (f: string, item: string) => `${f}: valor desconhecido "${item}" descartado`,
      outOfSpace: (f: string, v: string, space: string) => `${f}=${v} fora de ${SPACES['pt-BR'][space as keyof typeof SPACES.en]}: ignorado, o JEV decide`,
      deniedTools: (tools: string) => `forceTools contém tools em toolsDeny (removidas): ${tools}`,
      noModels: () => 'nenhum modelo habilitado (todas as listas efforts* vazias): mode=off',
      noTarget: () => 'agentsTarget vazio: mode=off',
    },
  },
} satisfies Record<Lang, unknown>

export type Strings = (typeof STRINGS)[Lang]

export const formatWarning = (s: Strings, w: Warning): string =>
  `JEV: ${(s.warn[w.code] as (...a: string[]) => string)(...w.args)}`
