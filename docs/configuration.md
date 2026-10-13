# Configuration

🌐 English · [Português (Brasil)](configuration.pt-BR.md)

Single source: `userConfig` in `.claude-plugin/plugin.json`. If they diverge, the code
(`src/config.ts`) wins. Invalid values revert to the default and raise a warning.

Adjust via `/config` (row `jev-orchestrator.<field>`) or `pluginConfigs["jev-orchestrator"].options` in settings.

| Field | Type | Default | Options | Description |
|---|---|---|---|---|
| `language` | string | `auto` | `auto`, `en`, `pt-BR` | language of plugin messages; auto: follows the Claude Code language (or the locale) and falls back to `en` |
| `mode` | string | `auto` | `auto`, `off`, `explicit` | auto: JEV decides; off: disabled; explicit: only `[jev]`; also changed with `/jev-orc` |
| `agentScope` | string | `builtin` | `builtin`, `all` | which agents the routing touches. builtin: Claude Code's own (`general-purpose`, `Explore`, `Plan`, `claude`, `claude-code-guide`, `statusline-setup`); all: those, your `.claude/agents` and the plugins' agents. Only `general-purpose`, `Explore` and `claude` may trade their type for a tool profile; every other agent keeps its own type, prompt and tools and gets only the model and the effort |
| `agentHints` | string | — | `name=text` pairs split by `\|` | short text JEV reads beside an agent's name, e.g. `go-code-reviewer=reviews Go code\|Plan=plans, never edits`; without a hint JEV reads the agent's own description from Claude Code. Every text is cut to 120 characters |
| `maxModel` | string | `opus` | `haiku`, `sonnet`, `opus` | the strongest model JEV may pick for a subagent |
| `maxEffort` | string | `xhigh` | `low`..`max` | the highest effort JEV may pick, for subagents and (`mainEffort`) your prompts |
| `mainEffort` | boolean | `false` | | JEV sets the effort of your own prompts; the session model stays |
| `multiModel` | boolean | `false` | | a second, stronger model reviews hard tasks JEV is unsure about (verifier) |
| `compareModel` | string | `auto` | `auto`, `haiku`, `sonnet`, `opus`, `fable` | model the status line prices the routed tokens against; auto: the model of your session. Only the status line changes, not the routing |
| `statusStyle` | string | `nerd` | `nerd`, `plain` | nerd: Nerd Font icons and `│` separators (needs a Nerd Font in the terminal); plain: text only, the previous format |
| `typesafeApiKey` | string (sensitive) | — | | JEV key (TypeSafe, or OpenRouter with the OpenRouter endpoint), stored in the Keychain and set in `/plugin` → Installed → jev-orchestrator → Configure options; precedence: `typesafeApiKey` → `TYPESAFE_API_KEY` → `JEV_API_KEY`; empty or whitespace-only counts as missing |
| `jevEndpoint` | string | `https://api.typesafe.ai/v1/systemone` | https URL | System One API; for OpenRouter, `https://openrouter.ai/api/v1/systemone` with an OpenRouter key in `typesafeApiKey`; anything not https reverts to the default |
| `logLevel` | string | `info` | `off`, `info`, `debug` | decision log level |

## Fixed values

No longer options; changed in `src/config.ts` if ever needed.

| Value | Fixed at |
|---|---|
| Active routed agents | at most 8; past that, fallback |
| Simultaneous JEV queries | 4 |
| JEV timeout | 8000 ms (the hook has 10 s) |
| Fallback when JEV fails | `sonnet` · `medium` · every tool group, capped by `maxModel`/`maxEffort` |
| Prices (US$/MTok, input/output/cache read/cache write) | haiku 0.1/0.5/0.01/0.125 · sonnet 2/10/0.2/2.5 · opus 4/20/0.2/5 |

## How the maximums apply

- JEV's model tier above `maxModel` drops to `maxModel`; a tier below it is kept.
- JEV's effort above `maxEffort` drops to `maxEffort`, whatever the model.
- With `multiModel`, the verifier is the strongest model up to `maxModel` other than the primary.
