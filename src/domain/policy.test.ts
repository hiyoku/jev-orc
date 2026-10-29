import { expect, test } from 'claude-code/testing'
import { EFFORTS, loadConfig, type Config } from '../config'
import type { JevAnswers } from '../jev/answers'
import { questions } from '../jev/questions'
import { decide, desiredEffort, type Decision } from './policy'

type Overrides = Partial<Record<'edits_files' | 'runs_shell' | 'web_research' | 'library_docs' | 'browser', number>>

// complexity as the chance of each level: 0 mechanical, 1 localized, 2 multi-file, 3 open design.
// deliberation as the level JEV is sure of: 0 low, 1 medium, 2 high, 3 xhigh, 4 max.
function answers(probabilities: number[], deliberation: number, nouls: Overrides = {}): JevAnswers {
  return {
    complexity: { score: probabilities.reduce((sum, p, level) => sum + p * level, 0), confidence: 0.9, probabilities },
    deliberation: { score: deliberation, confidence: 1, probabilities: EFFORTS.map((_, level) => (level === deliberation ? 1 : 0)) },
    edits_files: { noul: nouls.edits_files ?? 0 },
    runs_shell: { noul: nouls.runs_shell ?? 0 },
    web_research: { noul: nouls.web_research ?? 0 },
    library_docs: { noul: nouls.library_docs ?? 0 },
    browser: { noul: nouls.browser ?? 0 },
  }
}

const MECHANICAL = [0.9, 0.1, 0, 0]
const LOCALIZED = [0.1, 0.8, 0.1, 0]
const OPEN = [0, 0, 0.1, 0.9]

const cfg = (options = {}): Config => loadConfig(options).config

const routed = (decision: Decision) => decision

// --- selftest of route.py, ported 1:1 ---

test('simple read-only task: haiku, low, explore, read only', () => {
  const d = routed(decide(answers(MECHANICAL, 0), cfg()))
  expect([d.models, d.effort, d.profile, d.toolGroups]).toEqual([['haiku'], 'low', 'explore', ['read']])
})

test('edits_files 0.35 already writes', () => {
  const d = routed(decide(answers(MECHANICAL, 0, { edits_files: 0.35 }), cfg()))
  expect([d.profile, d.toolGroups]).toEqual(['general', ['read', 'edit']])
})

// route.py expected effort "medium" (only low/medium existed); deliberation level 4 is "max",
// projected to maxEffort (xhigh by default).
test('opus does not go higher; shell and docs groups', () => {
  const d = routed(decide(answers(OPEN, 4, { runs_shell: 0.9, library_docs: 0.6 }), cfg()))
  expect([d.models, d.effort, d.profile]).toEqual([['opus'], 'xhigh', 'explore'])
  expect(d.toolGroups).toEqual(['read', 'shell', 'docs'])
})

test('web research never stays on haiku', () => {
  const d = routed(decide(answers(MECHANICAL, 1, { web_research: 0.98 }), cfg()))
  expect(d.models).toEqual(['sonnet'])
  expect(d.toolGroups).toEqual(['read', 'web'])
})

test('runs_shell in the uncertainty band (0.3 to 0.5) still gets shell', () => {
  expect(routed(decide(answers(MECHANICAL, 0, { runs_shell: 0.35 }), cfg())).toolGroups).toEqual(['read', 'shell'])
  expect(routed(decide(answers(MECHANICAL, 0, { runs_shell: 0.25 }), cfg())).toolGroups).toEqual(['read'])
})

// --- the chance of each level, not the average ---

test('half mechanical, half open: the average says sonnet, the open half sends it to opus', () => {
  expect(routed(decide(answers([0.5, 0, 0, 0.5], 0), cfg())).models).toEqual(['opus'])
})

test('half localized, half multi-file: surely in the middle, so sonnet', () => {
  expect(routed(decide(answers([0, 0.5, 0.5, 0], 0), cfg())).models).toEqual(['sonnet'])
})

test('haiku only when the mechanical level is likely', () => {
  expect(routed(decide(answers([0.6, 0.4, 0, 0], 0), cfg())).models).toEqual(['haiku'])
  expect(routed(decide(answers([0.5, 0.5, 0, 0], 0), cfg())).models).toEqual(['sonnet'])
})

test('the model reason names the chances it came from', () => {
  expect(routed(decide(answers(OPEN, 0), cfg())).reasons).toContain('model opus: complexity p0 0.00, p3 0.90')
})

// --- maximums ---

test('maxModel caps the tier', () => {
  expect(routed(decide(answers(OPEN, 0), cfg({ maxModel: 'haiku' }))).models).toEqual(['haiku'])
  expect(routed(decide(answers(OPEN, 0), cfg({ maxModel: 'sonnet' }))).models).toEqual(['sonnet'])
  expect(routed(decide(answers(MECHANICAL, 0), cfg({ maxModel: 'sonnet' }))).models).toEqual(['haiku'])
})

test('maxEffort caps the effort', () => {
  const d = routed(decide(answers(LOCALIZED, 4), cfg({ maxEffort: 'medium' })))
  expect([d.models, d.effort]).toEqual([['sonnet'], 'medium'])
  expect(routed(decide(answers(LOCALIZED, 4), cfg({ maxEffort: 'max' }))).effort).toBe('max')
})

test('effort is independent of the model', () => {
  const sonnet = routed(decide(answers(LOCALIZED, 2), cfg()))
  const opus = routed(decide(answers(OPEN, 2), cfg()))
  expect([sonnet.models, opus.models]).toEqual([['sonnet'], ['opus']])
  expect([sonnet.effort, opus.effort]).toEqual(['high', 'high'])
})

// --- profile ---

test('a writing task goes to general, a read-only one to explore', () => {
  expect(routed(decide(answers(MECHANICAL, 0, { edits_files: 0.9 }), cfg())).profile).toBe('general')
  expect(routed(decide(answers(MECHANICAL, 0), cfg())).profile).toBe('explore')
})

// --- deliberation ---

test('deliberation has one level per effort', () => {
  expect(questions.deliberation.criteria).toHaveLength(EFFORTS.length)
})

test('the effort is the nearest deliberation level', () => {
  const split = (score: number) => ({ ...answers(LOCALIZED, 0), deliberation: { score, confidence: 0.5, probabilities: [0, 0, 0.5, 0.5, 0] } })
  expect(desiredEffort(split(2.4))).toBe('high')
  expect(desiredEffort(split(2.6))).toBe('xhigh')
})
