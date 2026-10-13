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

const routed = (decision: Decision) => decision

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
// projected to maxEffort (xhigh by default).
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

// --- maximums ---

test('maxModel caps the tier', () => {
  expect(routed(decide(answers(3, 0.9, 0.1), cfg({ maxModel: 'haiku' }))).models).toEqual(['haiku'])
  expect(routed(decide(answers(3, 0.9, 0.1), cfg({ maxModel: 'sonnet' }))).models).toEqual(['sonnet'])
  expect(routed(decide(answers(0.1, 0.9, 0.1), cfg({ maxModel: 'sonnet' }))).models).toEqual(['haiku'])
})

test('maxEffort caps the effort', () => {
  const d = routed(decide(answers(1, 0.9, 1), cfg({ maxEffort: 'medium' })))
  expect([d.models, d.effort]).toEqual([['sonnet'], 'medium'])
  expect(routed(decide(answers(1, 0.9, 1), cfg({ maxEffort: 'max' }))).effort).toBe('max')
})

test('effort is independent of the model', () => {
  const sonnet = routed(decide(answers(1, 0.9, 0.5), cfg()))
  const opus = routed(decide(answers(3, 0.9, 0.5), cfg()))
  expect([sonnet.models, opus.models]).toEqual([['sonnet'], ['opus']])
  expect([sonnet.effort, opus.effort]).toEqual(['high', 'high'])
})

// --- profile ---

test('a writing task goes to general, a read-only one to explore', () => {
  expect(routed(decide(answers(0.1, 0.9, 0.1, { edits_files: 0.9 }), cfg())).profile).toBe('general')
  expect(routed(decide(answers(0.1, 0.9, 0.1), cfg())).profile).toBe('explore')
})
