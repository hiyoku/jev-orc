import { expect, test } from 'claude-code/testing'
import { STRINGS, formatWarning } from './i18n'
import { HOOK_BUDGET_MS, JEV_TIMEOUT_MS, loadConfig } from './config'

test('defaults', () => {
  const { config, warnings } = loadConfig({})
  expect(warnings).toEqual([])
  expect(config).toMatchObject({ mode: 'auto', maxModel: 'opus', maxEffort: 'xhigh', multiModel: false, mainEffort: false, logLevel: 'info' })
  expect(config.efforts).toEqual(['low', 'medium', 'high', 'xhigh'])
  expect(config.fallback).toEqual({ model: 'sonnet', effort: 'medium', agent: 'general-purpose' })
})

test('maxEffort cuts the efforts', () => {
  expect(loadConfig({ maxEffort: 'medium' }).config.efforts).toEqual(['low', 'medium'])
  expect(loadConfig({ maxEffort: 'max' }).config.efforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
})

test('the fallback never goes above the maximums', () => {
  expect(loadConfig({ maxModel: 'haiku', maxEffort: 'low' }).config.fallback).toEqual({ model: 'haiku', effort: 'low', agent: 'general-purpose' })
  expect(loadConfig({ maxModel: 'opus', maxEffort: 'max' }).config.fallback).toMatchObject({ model: 'sonnet', effort: 'medium' })
})

test('an invalid value falls back to the default with a warning', () => {
  const { config, warnings } = loadConfig({ mode: 'turbo', maxModel: 'gpt' })
  expect(config.mode).toBe('auto')
  expect(config.maxModel).toBe('opus')
  expect(warnings.map((w) => formatWarning(STRINGS.en, w))).toEqual(['JEV: maxModel=gpt invalid: using opus', 'JEV: mode=turbo invalid: using auto'])
})

test('a blank key is no key', () => {
  expect(loadConfig({ typesafeApiKey: '  ' }).config.apiKey).toBeUndefined()
  expect(loadConfig({ typesafeApiKey: ' k ' }).config.apiKey).toBe('k')
})

test('jevEndpoint: https only; OpenRouter works, plain http falls back with a warning', () => {
  expect(loadConfig({}).config.endpoint).toBe('https://api.typesafe.ai/v1/systemone')
  expect(loadConfig({ jevEndpoint: ' https://openrouter.ai/api/v1/systemone ' }).config.endpoint).toBe('https://openrouter.ai/api/v1/systemone')
  const { config, warnings } = loadConfig({ jevEndpoint: 'http://example.com/systemone' })
  expect(config.endpoint).toBe('https://api.typesafe.ai/v1/systemone')
  expect(warnings).toHaveLength(1)
})

test('the JEV timeout leaves the hook a second of its budget', () => {
  expect(JEV_TIMEOUT_MS).toBeLessThanOrEqual(HOOK_BUDGET_MS - 1000)
})
