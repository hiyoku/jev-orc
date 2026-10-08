import { expect, test } from 'claude-code/testing'
import { loadConfig } from './config'

test('defaults', () => {
  const { config, warnings } = loadConfig({})
  expect(warnings).toEqual([])
  expect(config.mode).toBe('auto')
  expect(config.allowed.get('haiku')).toEqual(['low', 'medium'])
  expect(config.allowed.get('sonnet')).toEqual(['low', 'medium', 'high'])
  expect(config.allowed.get('opus')).toEqual(['medium', 'high', 'xhigh'])
  expect(config.fallback).toEqual({ model: 'sonnet', effort: 'medium', agent: 'general-purpose' })
  expect(config.agentsTarget).toEqual(['explore', 'general'])
  expect(config.maxAgents).toBe(8)
  expect(config.jevTimeoutMs).toBe(15000)
})

test('partial override keeps other defaults', () => {
  const { config } = loadConfig({ maxAgents: 3, effortsOpus: ['max'], logLevel: 'debug' })
  expect(config.maxAgents).toBe(3)
  expect(config.allowed.get('opus')).toEqual(['max'])
  expect(config.parallelism).toBe(4)
  expect(config.logLevel).toBe('debug')
})

test('empty effortsHaiku disables haiku', () => {
  const { config } = loadConfig({ effortsHaiku: [] })
  expect(config.allowed.get('haiku')).toEqual([])
  expect(config.mode).toBe('auto')
})

test('fallback on a disabled model moves to the first enabled of fallbackOrder', () => {
  const { config } = loadConfig({ effortsSonnet: [], fallbackModel: 'sonnet' })
  expect(config.fallback.model).toBe('opus')
  expect(config.fallback.effort).toBe('medium')
})

test('fallbackEffort above the allowed picks the highest allowed below it', () => {
  const { config } = loadConfig({ fallbackEffort: 'xhigh' })
  expect(config.fallback.effort).toBe('high')
})

test('everything disabled -> off with warning', () => {
  const { config, warnings } = loadConfig({ effortsHaiku: [], effortsSonnet: [], effortsOpus: [] })
  expect(config.mode).toBe('off')
  expect(warnings.length).toBe(1)
})

test('agentsTarget ["general"] is kept; empty -> off', () => {
  expect(loadConfig({ agentsTarget: ['general'] }).config.agentsTarget).toEqual(['general'])
  const { config, warnings } = loadConfig({ agentsTarget: [] })
  expect(config.mode).toBe('off')
  expect(warnings.length).toBe(1)
})

test('unknown effort is dropped with a warning', () => {
  const { config, warnings } = loadConfig({ effortsSonnet: ['low', 'turbo'] })
  expect(config.allowed.get('sonnet')).toEqual(['low'])
  expect(warnings[0]).toContain('turbo')
})

test('forceEffort outside efforts* is rejected naming the field', () => {
  const { config, warnings } = loadConfig({ forceEffort: 'max' })
  expect(config.force.effort).toBe(undefined)
  expect(warnings[0]).toContain('forceEffort=max')
})

test('forceEffort inside efforts* is kept; "jev" means not forced', () => {
  expect(loadConfig({ forceEffort: 'high' }).config.force.effort).toBe('high')
  expect(loadConfig({ forceEffort: 'jev', forceModel: 'jev' }).config.force).toEqual({
    model: undefined, effort: undefined, effortExplore: undefined, effortGeneral: undefined,
    agent: undefined, tools: undefined,
  })
})

test('forceEffortExplore and forceEffort both survive validation for the policy to rank', () => {
  const { config, warnings } = loadConfig({ forceEffort: 'high', forceEffortExplore: 'low' })
  expect(warnings).toEqual([])
  expect(config.force.effortExplore).toBe('low')
  expect(config.force.effort).toBe('high')
})

test('forceModel on a disabled model and forceAgent outside agentsTarget are rejected', () => {
  const { config, warnings } = loadConfig({ effortsHaiku: [], forceModel: 'haiku', agentsTarget: ['general'], forceAgent: 'explore' })
  expect(config.force.model).toBe(undefined)
  expect(config.force.agent).toBe(undefined)
  expect(warnings.length).toBe(2)
})

test('forceTools drops tools in toolsDeny with a warning', () => {
  const { config, warnings } = loadConfig({ forceTools: ['Read', 'Bash'], toolsDeny: ['Bash'] })
  expect(config.force.tools).toEqual(['Read'])
  expect(warnings[0]).toContain('Bash')
})

test('invalid mode falls back to auto', () => {
  const { config, warnings } = loadConfig({ mode: 'turbo' })
  expect(config.mode).toBe('auto')
  expect(warnings[0]).toContain('mode')
})

test('runs under test(name, { options }, body)', { options: { effortsHaiku: [], maxAgents: 2 } }, () => {
  const { config } = loadConfig({ effortsHaiku: [], maxAgents: 2 })
  expect(config.allowed.get('haiku')).toEqual([])
  expect(config.maxAgents).toBe(2)
})
