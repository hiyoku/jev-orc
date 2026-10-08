import { expect, test } from 'claude-code/testing'
import { loadConfig } from '../config'
import { resolveTools } from './catalog'

const cfg = (o: Record<string, string[]> = {}) => loadConfig(o).config
const BUILTIN = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'WebFetch']
const WITH_MCP = [...BUILTIN, 'mcp__context7__query-docs', 'mcp__context7__resolve-library-id', 'mcp__other__x']

test('group with no available tool is empty', () => {
  expect(resolveTools(['web', 'edit'], ['Read'], cfg())).toEqual([])
})

test('MCP group is empty while the server is absent', () => {
  expect(resolveTools(['docs', 'browser'], BUILTIN, cfg())).toEqual([])
})

test('wildcard expands MCP group, ignoring other servers', () => {
  expect(resolveTools(['docs'], WITH_MCP, cfg())).toEqual(['mcp__context7__query-docs', 'mcp__context7__resolve-library-id'])
})

test('nonexistent tool never appears (NotebookEdit, WebSearch not available)', () => {
  expect(resolveTools(['edit', 'web'], BUILTIN, cfg())).toEqual(['Edit', 'Write', 'WebFetch'])
})

test('allow restricts', () => {
  expect(resolveTools(['read', 'edit'], BUILTIN, cfg({ toolsAllow: ['Read', 'Edit'] }))).toEqual(['Read', 'Edit'])
})

test('deny beats allow', () => {
  const c = cfg({ toolsAllow: ['Read', 'Edit'], toolsDeny: ['Edit'] })
  expect(resolveTools(['read', 'edit'], BUILTIN, c)).toEqual(['Read'])
})

test('wildcard in allow and deny', () => {
  const c = cfg({ toolsAllow: ['mcp__context7__*'], toolsDeny: ['mcp__context7__resolve*'] })
  expect(resolveTools(['read', 'docs'], WITH_MCP, c)).toEqual(['mcp__context7__query-docs'])
})

test('no duplicates, available order', () => {
  expect(resolveTools(['read', 'read', 'shell'], BUILTIN, cfg())).toEqual(['Bash', 'Read', 'Grep', 'Glob'])
})
