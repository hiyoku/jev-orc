import type { ToolGroup } from './groups'

// Names or `prefix*` patterns. Only tools seen in the built-in .d.ts / spike H7 list.
export const GROUP_PATTERNS: Record<ToolGroup, readonly string[]> = {
  read: ['Read', 'Grep', 'Glob'],
  edit: ['Edit', 'Write', 'NotebookEdit'],
  shell: ['Bash'],
  web: ['WebSearch', 'WebFetch'],
  docs: ['mcp__context7__*'],
  browser: ['mcp__claude-in-chrome__*'],
}

export const matches = (pattern: string, name: string) =>
  pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name
