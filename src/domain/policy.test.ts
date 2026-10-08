import { expect, test } from 'claude-code/testing'
import { loadConfig, type Config } from '../config'
import type { JevAnswers } from '../jev/answers'
import { decide, type Decision } from './policy'

type Overrides = Partial<Record<'edits_files' | 'runs_shell' | 'web_research' | 'library_docs' | 'browser', number>>

function answers(score: number, confidence: number, deliberation: number, nouls: Overrides = {}): JevAnswers {
  return {
    complexity: { score, confidence },
    deliberation: { noul: deliberation },
    edits_files: { noul: nouls.edits_files ?? 0 },
    runs_shell: { noul: nouls.runs_shell ?? 0 },
    web_research: { noul: nouls.web_research ?? 0 },
    library_docs: { noul: nouls.library_docs ?? 0 },
    browser: { noul: nouls.browser ?? 0 },
  }
}

const cfg = (options = {}): Config => loadConfig(options).config

function routed(decision: Decision) {
  if ('skip' in decision) throw new Error(`skip: ${decision.skip}`)
  return decision
}

// --- selftest of route.py, ported 1:1 ---

test('simple read-only task: haiku, low, explore, read only', () => {
  const d = routed(decide(answers(0.1, 0.9, 0.1), cfg()))
  expect([d.models, d.effort, d.profile, d.toolGroups]).toEqual([['haiku'], 'low', 'explore', ['read']])
})

test('low confidence raises a tier; edits_files 0.35 already writes', () => {
  const d = routed(decide(answers(0.1, 0.2, 0.1, { edits_files: 0.35 }), cfg()))
  expect([d.models, d.profile, d.toolGroups]).toEqual([['sonnet'], 'general', ['read', 'edit']])
})

// route.py expected effort "medium" (only low/medium existed); deliberation 0.9 is now "max",
// projected to the highest opus allows by default (xhigh).
test('opus does not go higher; shell and docs groups', () => {
  const d = routed(decide(answers(2.8, 0.1, 0.9, { runs_shell: 0.9, library_docs: 0.6 }), cfg()))
  expect([d.models, d.effort, d.profile]).toEqual([['opus'], 'xhigh', 'explore'])
  expect(d.toolGroups).toEqual(['read', 'shell', 'docs'])
})

test('web research never stays on haiku', () => {
  const d = routed(decide(answers(0.48, 0.5, 0.31, { web_research: 0.98 }), cfg()))
  expect(d.models).toEqual(['sonnet'])
  expect(d.toolGroups).toEqual(['read', 'web'])
})

// --- model projection ---

test('only haiku enabled: every tier lands on haiku', () => {
  const config = cfg({ effortsSonnet: [], effortsOpus: [] })
  expect(routed(decide(answers(3, 0.9, 0.1), config)).models).toEqual(['haiku'])
})

test('only opus enabled: every tier lands on opus', () => {
  const config = cfg({ effortsHaiku: [], effortsSonnet: [] })
  expect(routed(decide(answers(0.1, 0.9, 0.1), config)).models).toEqual(['opus'])
})

test('missing tier goes to the nearest above, else below', () => {
  expect(routed(decide(answers(0.1, 0.9, 0.1), cfg({ effortsHaiku: [] }))).models).toEqual(['sonnet'])
  expect(routed(decide(answers(3, 0.9, 0.1), cfg({ effortsOpus: [] }))).models).toEqual(['sonnet'])
})

// --- effort projection ---

test('effort max requested with sonnet [low, medium] becomes medium', () => {
  const d = routed(decide(answers(1, 0.9, 1), cfg({ effortsSonnet: ['low', 'medium'] })))
  expect([d.models, d.effort]).toEqual([['sonnet'], 'medium'])
})

test('effort low requested with opus [high] becomes high', () => {
  const d = routed(decide(answers(3, 0.9, 0), cfg({ effortsOpus: ['high'] })))
  expect([d.models, d.effort]).toEqual([['opus'], 'high'])
})

test('effort is independent of the model', () => {
  const sonnet = routed(decide(answers(1, 0.9, 0.5), cfg()))
  const opus = routed(decide(answers(3, 0.9, 0.5), cfg()))
  expect([sonnet.models, opus.models]).toEqual([['sonnet'], ['opus']])
  expect([sonnet.effort, opus.effort]).toEqual(['high', 'high'])
})

test('same model, different allowed efforts, different result', () => {
  const wide = routed(decide(answers(1, 0.9, 0.7), cfg({ effortsSonnet: ['low', 'medium', 'high'] })))
  const narrow = routed(decide(answers(1, 0.9, 0.7), cfg({ effortsSonnet: ['low', 'medium'] })))
  expect([wide.effort, narrow.effort]).toEqual(['high', 'medium'])
})

// --- profile ---

test('agentsTarget [general] with a read-only task goes to general', () => {
  const d = routed(decide(answers(0.1, 0.9, 0.1), cfg({ agentsTarget: ['general'] })))
  expect(d.profile).toBe('general')
})

test('agentsTarget [explore] with a writing task is not routed', () => {
  const d = decide(answers(0.1, 0.9, 0.1, { edits_files: 0.9 }), cfg({ agentsTarget: ['explore'] }))
  expect('skip' in d).toBe(true)
})

// --- force ---

test('forceModel opus with JEV asking haiku: opus, effort still from the JEV', () => {
  const d = routed(decide(answers(0.1, 0.9, 0.1), cfg({ forceModel: 'opus', effortsOpus: ['low', 'medium', 'high'] })))
  expect([d.models, d.effort]).toEqual([['opus'], 'low'])
  expect(d.reasons.join('\n')).toContain('forced by config')
})

test('forceEffortExplore low + JEV high: low only on explore, general follows the JEV', () => {
  const config = cfg({ forceEffortExplore: 'low' })
  const explore = routed(decide(answers(1, 0.9, 0.5), config))
  const general = routed(decide(answers(1, 0.9, 0.5, { edits_files: 1 }), config))
  expect([explore.profile, explore.effort]).toEqual(['explore', 'low'])
  expect([general.profile, general.effort]).toEqual(['general', 'high'])
})

test('forceEffort applies to any profile; the profile-specific force wins over it', () => {
  const config = cfg({ forceEffort: 'medium', forceEffortGeneral: 'high' })
  expect(routed(decide(answers(1, 0.9, 0.9), config)).effort).toBe('medium')
  expect(routed(decide(answers(1, 0.9, 0.1, { edits_files: 1 }), config)).effort).toBe('high')
})

test('forceTools are carried next to the JEV groups', () => {
  const d = routed(decide(answers(1, 0.9, 0.1, { runs_shell: 0.9 }), cfg({ forceTools: ['Read', 'Grep'] })))
  expect(d.forcedTools).toEqual(['Read', 'Grep'])
  expect(d.toolGroups).toEqual(['read', 'shell'])
})

test('forceAgent general sends a read-only task to general', () => {
  expect(routed(decide(answers(0.1, 0.9, 0.1), cfg({ forceAgent: 'general' }))).profile).toBe('general')
})

test('everything forced works without answers', () => {
  const config = cfg({ forceModel: 'sonnet', forceEffort: 'high', forceAgent: 'general', forceTools: ['Read'] })
  const d = routed(decide(undefined, config))
  expect([d.models, d.effort, d.profile, d.forcedTools]).toEqual([['sonnet'], 'high', 'general', ['Read']])
})

test('missing answers with a dimension not forced skips', () => {
  const d = decide(undefined, cfg({ forceModel: 'sonnet', forceAgent: 'general' }))
  expect(d).toEqual({ skip: 'sem resposta do JEV e sem force para: effort, tools' })
})
