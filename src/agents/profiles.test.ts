import { expect, test } from 'claude-code/testing'
import type { Decision } from '../domain/policy'
import type { ToolGroup } from '../tools/groups'
import { buildProfiles, FALLBACK_PROFILE, profileFor } from './profiles'

const names = () => buildProfiles().map((spec) => spec.name)

const decision = (toolGroups: ToolGroup[], extra: Partial<Decision> = {}): Decision => ({
  models: ['sonnet'],
  effort: 'low',
  toolGroups,
  profile: toolGroups.includes('edit') ? 'general' : 'explore',
  reasons: [],
  ...extra,
})

const START = { cwd: '/work', surface: null, isInteractive: false }

test('default config: 32 combinations plus fallback', () => {
  expect(names()).toHaveLength(33)
  expect(names()).toContain('t-read')
  expect(names()).toContain('fallback')
})

test('name is stable and follows the group order, not the decision order', () => {
  expect(profileFor(decision(['shell', 'edit', 'read']))).toBe('jev-orchestrator:t-read-edit-shell')
})

test('names are valid and at most 64 chars', () => {
  for (const name of names()) {
    expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  }
})

test('specs carry tools and prompt, never model or effort', () => {
  const spec = buildProfiles().find((s) => s.name === 't-read-edit-docs')!
  expect(spec.tools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit', 'mcp__context7__*'])
  expect(spec.model).toBeUndefined()
  expect(spec.effort).toBeUndefined()
})

test('read-only profiles say so in the prompt', () => {
  const specs = buildProfiles()
  expect(specs.find((s) => s.name === 't-read')!.prompt).toContain('read-only')
  expect(specs.find((s) => s.name === 't-read-edit')!.prompt).not.toContain('read-only')
})

test('shell profiles without edit tools run the commands the task asks for', () => {
  const prompt = buildProfiles().find((s) => s.name === 't-read-shell')!.prompt
  expect(prompt).toContain('git and gh included')
  expect(prompt).not.toContain('read-only')
})

test('fallback has every group', () => {
  expect(FALLBACK_PROFILE).toBe('jev-orchestrator:fallback')
  expect(buildProfiles().at(-1)!.tools).toContain('mcp__claude-in-chrome__*')
})

test('session.start registers every spec; a failing one is a toast, not a crash', async ($, on) => {
  const registered: string[] = []
  const toasts: string[] = []
  on('session.start', (_, e) => e)
  on('ui.toast', (_, e) => (toasts.push(e.text), { value: undefined }))
  on('agent.register', (_, spec) => {
    if (spec.name === 't-read') throw new Error('boom')
    registered.push(spec.name)
    return { value: { agent: `jev-orchestrator:${spec.name}` } }
  })
  await $.session.start(START)
  expect(registered).toHaveLength(32)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('t-read')
})

test('agent.offer hides the profiles and leaves other agents alone', async ($, on) => {
  const offer = (agent: string) =>
    $.agent.offer({ agent, description: '', source: 'plugin', provider: { plugin: 'x', tier: 'user' } })
  on('agent.offer', () => ({ isOffered: true }))
  expect(await offer('jev-orchestrator:t-read')).toEqual({ isOffered: false })
  expect(await offer('Explore')).toEqual({ isOffered: true })
})
