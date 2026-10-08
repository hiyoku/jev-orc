import type { AgentSpec } from 'claude-code'
import type { Config } from '../config'
import type { Decision } from '../domain/policy'
import { GROUP_PATTERNS, matches } from '../tools/catalog'
import { TOOL_GROUPS, type ToolGroup } from '../tools/groups'

const PLUGIN = 'jev-orchestrator'
const FORCED = 'forced'
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

export function buildProfiles(config: Config): AgentSpec[] {
  const specs = new Map<string, AgentSpec>()
  const add = (name: string, description: string, tools: string[], dedupe = false) => {
    if (tools.length === 0 || (dedupe && [...specs.values()].some((spec) => sameTools(spec.tools, tools)))) return
    specs.set(name, {
      name,
      description,
      prompt: promptFor(tools),
      tools,
      ...(config.toolsDeny.length > 0 && { disallowedTools: config.toolsDeny }),
    })
  }

  for (const groups of combinations()) {
    if (isFiltered(groups, config)) continue
    add(nameOf(groups), `Tool profile: ${groups.join(', ')}`, toolsOf(groups, config), true)
  }
  if (config.force.tools) add(FORCED, 'Tool profile: tools forced by config', config.force.tools)
  add(FALLBACK, 'Tool profile: every tool group', toolsOf(TOOL_GROUPS, config))
  return [...specs.values()]
}

export function profileFor(decision: Decision, config: Config): string | undefined {
  if ('skip' in decision) return undefined
  const profiles = buildProfiles(config)
  const name = decision.forcedTools ? FORCED : nameOf(decision.toolGroups)
  const wanted = decision.forcedTools ?? toolsOf(decision.toolGroups, config)
  if (profiles.some((spec) => spec.name === name)) return `${PLUGIN}:${name}`
  // A deduplicated combination resolves to the spec that kept its tools.
  const twin = profiles.find((spec) => sameTools(spec.tools, wanted))
  return twin && twin.name !== FORCED && twin.name !== FALLBACK ? `${PLUGIN}:${twin.name}` : undefined
}

function combinations(): ToolGroup[][] {
  return OPTIONAL_GROUPS.reduce<ToolGroup[][]>(
    (acc, group) => acc.flatMap((groups) => [groups, [...groups, group]]),
    [['read']],
  )
}

function isFiltered(groups: readonly ToolGroup[], { agentsTarget }: Config): boolean {
  return groups.includes('edit') ? !agentsTarget.includes('general') : !agentsTarget.includes('explore')
}

function nameOf(groups: readonly ToolGroup[]): string {
  return `t-${TOOL_GROUPS.filter((group) => groups.includes(group)).join('-')}`
}

function toolsOf(groups: readonly ToolGroup[], { toolsAllow }: Config): string[] {
  const patterns = groups.flatMap((group) => GROUP_PATTERNS[group])
  if (toolsAllow.length === 0) return [...new Set(patterns)]
  // Keep a pattern an allow entry covers; narrow it to the allow entry it covers instead.
  const kept = patterns.flatMap((pattern) => [
    ...toolsAllow.filter((allow) => matches(allow, pattern)).map(() => pattern),
    ...toolsAllow.filter((allow) => !matches(allow, pattern) && matches(pattern, allow)),
  ])
  return [...new Set(kept)]
}

function promptFor(tools: readonly string[]): string {
  const writes = tools.some((tool) => GROUP_PATTERNS.edit.includes(tool))
  return writes ? BASE_PROMPT : `${BASE_PROMPT} ${READ_ONLY_PROMPT}`
}

function sameTools(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && b.every((tool) => a.includes(tool))
}
