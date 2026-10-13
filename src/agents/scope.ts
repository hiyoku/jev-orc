export const SCOPES = ['builtin', 'all'] as const
export type Scope = (typeof SCOPES)[number]

// The agents Claude Code ships; the fallback while agent.offer has not named a type's source yet.
export const BUILTIN_AGENTS = ['general-purpose', 'Explore', 'Plan', 'claude', 'claude-code-guide', 'statusline-setup']
// Generic agents: the plugin may swap them for one of its tool profiles. Any other agent keeps its
// own type (prompt and tools) and gets only the model and the effort.
export const GENERIC_AGENTS = ['general-purpose', 'Explore', 'claude']
export const HINT_MAX = 120

// What agent.offer said of a type: where its definition came from (`built-in`, `plugin`, a settings source) and its listing line.
export type Offered = { source: string; description: string }

// builtin: only Claude Code's own agents; all: those, the ones in .claude/agents and the plugins'.
export function intercepts(scope: Scope, type: string, offered: Offered | undefined): boolean {
  if (scope === 'all') return true
  return offered ? offered.source === 'built-in' : BUILTIN_AGENTS.includes(type)
}

export const swapsProfile = (type: string) => GENERIC_AGENTS.includes(type)

// "name=text|name=text" → name → text, each text cut to HINT_MAX; an entry without both parts is dropped.
export function parseHints(value: unknown): Map<string, string> {
  const hints = new Map<string, string>()
  if (typeof value !== 'string') return hints
  for (const entry of value.split('|')) {
    const at = entry.indexOf('=')
    const name = entry.slice(0, at).trim()
    const text = entry.slice(at + 1).trim()
    if (at > 0 && name && text) hints.set(name, text.slice(0, HINT_MAX))
  }
  return hints
}

// What JEV reads beside the agent's name: the user's hint, else the host's listing line, cut to HINT_MAX.
export const hintFor = (type: string, offered: Offered | undefined, hints: Map<string, string>): string =>
  hints.get(type) ?? (offered?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, HINT_MAX)
