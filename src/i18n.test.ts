import { expect, test } from 'claude-code/testing'
import { loadConfig } from './config'
import { formatWarning, resolveLanguage, STRINGS } from './i18n'

test('an explicit option wins over settings and locale', () => {
  expect(resolveLanguage('en', 'portuguese', 'pt_BR.UTF-8')).toBe('en')
  expect(resolveLanguage('pt-BR', 'english', 'en_US.UTF-8')).toBe('pt-BR')
})

test('auto: the settings language, then the locale, else en', () => {
  expect(resolveLanguage('auto', 'portuguese', 'en_US.UTF-8')).toBe('pt-BR')
  expect(resolveLanguage('auto', 'Português', undefined)).toBe('pt-BR')
  expect(resolveLanguage('auto', 'pt-BR', undefined)).toBe('pt-BR')
  expect(resolveLanguage('auto', 'english', 'pt_BR.UTF-8')).toBe('en') // the settings win over the locale
  expect(resolveLanguage('auto', undefined, 'pt_BR.UTF-8')).toBe('pt-BR')
  expect(resolveLanguage(undefined, '  ', 'PT_br')).toBe('pt-BR')
  expect(resolveLanguage('auto', undefined, 'de_DE.UTF-8')).toBe('en')
  expect(resolveLanguage('auto', undefined, undefined)).toBe('en')
  expect(resolveLanguage('auto', '', '')).toBe('en')
})

// Same keys, same shape (function arity), at every depth.
const shape = (v: unknown): unknown =>
  typeof v === 'function' ? `fn${v.length}` : typeof v === 'object' && v ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : 'str'

test('en and pt-BR have the same keys', () => {
  expect(shape(STRINGS['pt-BR'])).toEqual(shape(STRINGS.en))
})

test('a toast in both languages', () => {
  expect(STRINGS.en.toastLog).toBe('JEV: failed to write the decision log')
  expect(STRINGS['pt-BR'].toastLog).toBe('JEV: falha ao gravar o log de decisões')
})

test('a config warning is translated where it is shown', () => {
  const { warnings } = loadConfig({ mode: 'turbo' })
  expect(formatWarning(STRINGS.en, warnings[0])).toBe('JEV: mode=turbo invalid: using auto')
  expect(formatWarning(STRINGS['pt-BR'], warnings[0])).toBe('JEV: mode=turbo inválido: usando auto')
})
