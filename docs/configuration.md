# Configuration

🌐 English · [Português (Brasil)](configuration.pt-BR.md)

Single source: `userConfig` in `.claude-plugin/plugin.json`. If they diverge, the code
(`src/config.ts`) wins. Invalid values revert to the default and raise a warning.

Adjust via `/config` (row `jev-orchestrator.<field>`) or `pluginConfigs["jev-orchestrator"].options` in settings.

| Field | Type | Default | Options | Description |
|---|---|---|---|---|
| `mode` | string | `auto` | `auto`, `off`, `explicit` | auto: JEV decides; off: disabled; explicit: only `[jev]`; also changed with `/jev-orc` |
| `effortsHaiku` | list | `low`, `medium` | `low`..`max` | efforts allowed with haiku; empty disables haiku |
| `effortsSonnet` | list | `low`, `medium`, `high` | `low`..`max` | same, sonnet |
| `effortsOpus` | list | `medium`, `high`, `xhigh` | `low`..`max` | same, opus |
| `fallbackOrder` | list | `sonnet`, `opus`, `haiku` | models | order tried when the chosen one is disabled |
| `agentsIntercept` | list | `general-purpose`, `Explore` | agent types | types the mod rewrites; the rest pass untouched |
| `agentsTarget` | list | `explore`, `general` | `explore`, `general` | profiles the mod may transition to |
| `forceModel` | string | `jev` | `jev`, `haiku`, `sonnet`, `opus` | `jev`: JEV decides |
| `forceEffort` | string | `jev` | `jev`, `low`..`max` | fixed effort for any profile |
| `forceEffortExplore` | string | `jev` | same | fixed effort for the explore profile only |
| `forceEffortGeneral` | string | `jev` | same | fixed effort for the general profile only |
| `forceAgent` | string | `jev` | `jev`, `explore`, `general` | fixed profile |
| `forceTools` | list | `[]` | tool names | fixed tools; empty: JEV decides |
| `fallbackModel` | string | `sonnet` | `haiku`, `sonnet`, `opus` | model when JEV fails |
| `fallbackEffort` | string | `medium` | `low`..`max` | effort when JEV fails |
| `fallbackAgent` | string | `general-purpose` | free | agent type when JEV fails |
| `multiModel` | boolean | `false` | | allows different models in the same task (verifier) |
| `maxModelsPerTask` | number | `1` | integer >= 1 | maximum models per task |
| `maxAgents` | number | `8` | integer >= 1 | maximum active routed agents |
| `parallelism` | number | `4` | integer >= 1 | simultaneous JEV queries |
| `toolsAllow` | list | `[]` | names or `*` suffix | tools JEV may assign; empty: no restriction |
| `toolsDeny` | list | `[]` | names or `*` suffix | tools never assigned |
| `jevTimeoutMs` | number | `8000` | integer 1..9000 | maximum wait for JEV |
| `typesafeApiKey` | string (sensitive) | — | | JEV key, stored in the Keychain and set in `/plugin` → Installed → jev-orchestrator → Configure options; precedence: `typesafeApiKey` → `TYPESAFE_API_KEY` → `JEV_API_KEY`; empty or whitespace-only counts as missing |
| `jevEndpoint` | string | `https://api.typesafe.ai/v1/systemone` | URL | JEV API |
| `logLevel` | string | `info` | `off`, `info`, `debug` | decision log level |
| `priceHaiku` | string | `0.1,0.5,0.01,0.125` | `input,output,cacheRead,cacheWrite` | US$/MTok (5-minute cache write) |
| `priceSonnet` | string | `2,10,0.2,2.5` | same | same |
| `priceOpus` | string | `4,20,0.2,5` | same | same |
| `language` | string | `auto` | `auto`, `en`, `pt-BR` | language of plugin messages; auto: follows the Claude Code language (or the locale) and falls back to `en` |
| `jevPricePerCall` | number | `0` | >= 0 | US$ per JEV call, added to the actual cost on the status line |

Lists accept `low`, `medium`, `high`, `xhigh`, `max` for efforts. `*` only works at the end of the
pattern (`mcp__context7__*`).

## Validation rules

- An empty `efforts*` list disables the model. All empty, or empty `agentsTarget`: `mode=off` with a warning.
- Unknown values in lists (`fallbackOrder`, `agentsTarget`, `efforts*`) are discarded with a warning.
- Disabled `fallbackModel`: uses the first enabled one in `fallbackOrder`; a `fallbackEffort` outside
  the model's allowed set drops to the highest allowed effort below it (or to the lowest allowed).
- Force precedence: `forceEffortExplore`/`forceEffortGeneral` (of the resolved profile) win over `forceEffort`.
  A force outside the enabled space (disabled model, effort outside `efforts*`, profile outside
  `agentsTarget`) is ignored, and JEV decides.
- `forceTools` goes through `toolsDeny` (denied ones are removed, with a warning) and becomes the
  `jev-orchestrator:forced` profile, with those tools. `toolsDeny` wins over `toolsAllow`.
- If the forces cover model, agent, effort, and tools, JEV is not even queried.
- `jevTimeoutMs` above 9000 (or not an integer) is invalid and reverts to 8000: the hook has 10 s and
  the timeout comes out of that budget.
- An invalid price (not 4 numbers >= 0) reverts to the default with a warning.
