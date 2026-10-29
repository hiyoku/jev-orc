export type Savings = {
  /** Routed (and verifier) agents whose turn completed. */
  agents: number
  tokens: number
  /** Real cost of the tokens, US$; the JEV calls are added when the status is drawn. */
  cost: number
  /** The same tokens at the parent model's price; null once a parent model is unknown. */
  estimated: number | null
  jevCalls: number
  /** The model the routed tokens are priced against: the session's model (`compareModel: auto`) or the chosen one. */
  parent: string
  route: string
}

/** Where the API key comes from, for other plugins to show; the key itself never leaves the plugin. */
export type KeyStatus = {
  source: 'option' | 'TYPESAFE_API_KEY' | 'JEV_API_KEY' | 'none'
  env: { TYPESAFE_API_KEY: boolean; JEV_API_KEY: boolean }
  /** The endpoint's host, not its path. */
  endpoint: string
}

declare module 'claude-code' {
  interface PluginState {
    'jev-orchestrator': {
      savings: Savings
      /** The mode this load runs in, for other plugins to read. */
      mode: 'auto' | 'off' | 'explicit'
      /** Every session's savings summed: a copy of the $.store total other plugins can read. */
      total: Savings
      key: KeyStatus
    }
  }
}
