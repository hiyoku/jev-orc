export type Savings = {
  /** Routed (and verifier) agents whose turn completed. */
  agents: number
  tokens: number
  /** Real cost of the tokens, US$; the JEV calls are added when the status is drawn. */
  cost: number
  /** The same tokens at the parent model's price; null once a parent model is unknown. */
  estimated: number | null
  jevCalls: number
  parent: string
  route: string
}

declare module 'claude-code' {
  interface PluginState {
    'jev-orchestrator': { savings: Savings }
  }
}
