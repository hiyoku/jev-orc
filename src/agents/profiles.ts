import type { AgentSpec } from 'claude-code'
import type { Decision } from '../domain/policy'
import { GROUP_PATTERNS } from '../tools/catalog'
import { TOOL_GROUPS, type ToolGroup } from '../tools/groups'

const PLUGIN = 'jev-orchestrator'
const FALLBACK = 'fallback'

export const FALLBACK_PROFILE = `${PLUGIN}:${FALLBACK}`
export const PROFILE_MATCHER = new RegExp(`^${PLUGIN}:`)

const OPTIONAL_GROUPS = TOOL_GROUPS.filter((group) => group !== 'read')

const BASE_PROMPT = [
  'You are an agent for Claude Code. Complete the task in the prompt fully, without gold-plating.',
  'Search broadly when you do not know where something lives, then narrow down.',
  'In your final report, state what you found or did, cite file:line for every claim, and say how you verified it.',
].join(' ')
const READ_ONLY_PROMPT = 'You are read-only: you cannot modify files. Never try to; report findings instead.'
// Shell without edit tools: the git, gh, test and script commands a task asks for must still run.
const SHELL_PROMPT = 'You have no edit tools: do not change file contents yourself, but run every shell command the task asks for, git and gh included.'

// One profile per combination of tool groups, plus the fallback with every group.
export function buildProfiles(): AgentSpec[] {
  const spec = (name: string, description: string, tools: string[]): AgentSpec => ({ name, description, prompt: promptFor(tools), tools })
  return [
    ...combinations().map((groups) => spec(nameOf(groups), `Tool profile: ${groups.join(', ')}`, toolsOf(groups))),
    spec(FALLBACK, 'Tool profile: every tool group', toolsOf(TOOL_GROUPS)),
  ]
}

export const profileFor = (decision: Decision): string => `${PLUGIN}:${nameOf(decision.toolGroups)}`

function combinations(): ToolGroup[][] {
  return OPTIONAL_GROUPS.reduce<ToolGroup[][]>(
    (acc, group) => acc.flatMap((groups) => [groups, [...groups, group]]),
    [['read']],
  )
}

function nameOf(groups: readonly ToolGroup[]): string {
  return `t-${TOOL_GROUPS.filter((group) => groups.includes(group)).join('-')}`
}

const toolsOf = (groups: readonly ToolGroup[]): string[] => [...new Set(groups.flatMap((group) => GROUP_PATTERNS[group]))]

function promptFor(tools: readonly string[]): string {
  const has = (group: ToolGroup) => tools.some((tool) => GROUP_PATTERNS[group].includes(tool))
  if (has('edit')) return BASE_PROMPT
  return `${BASE_PROMPT} ${has('shell') ? SHELL_PROMPT : READ_ONLY_PROMPT}`
}

