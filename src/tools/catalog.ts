import type { EngineInterface } from 'claude-code'
import type { Config } from '../config'
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

const matchesAny = (patterns: readonly string[], name: string) =>
  patterns.some((pattern) => matches(pattern, name))

/** Real tool names for `groups`: only names in `available`, in `available` order, no duplicates. */
export function resolveTools(groups: ToolGroup[], available: string[], config: Config): string[] {
  const patterns = groups.flatMap((group) => GROUP_PATTERNS[group])
  const { toolsAllow, toolsDeny } = config
  const seen = new Set<string>()
  return available.filter((name) => {
    if (seen.has(name) || !matchesAny(patterns, name)) return false
    if (toolsAllow.length > 0 && !matchesAny(toolsAllow, name)) return false
    if (matchesAny(toolsDeny, name)) return false
    seen.add(name)
    return true
  })
}

/** Names the model can call right now. No cache: at session.start MCP tools are still absent (H7). */
export async function listAvailableTools($: EngineInterface): Promise<string[]> {
  return (await $.tool.list()).map((tool) => tool.name)
}
