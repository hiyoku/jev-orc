export const TOOL_GROUPS = ['read', 'edit', 'shell', 'web', 'docs', 'browser'] as const

export type ToolGroup = (typeof TOOL_GROUPS)[number]
