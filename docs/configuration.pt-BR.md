# Configuração

🌐 [English](configuration.md) · Português (Brasil)

Fonte única: `userConfig` em `.claude-plugin/plugin.json`. Em caso de divergência, vale o código
(`src/config.ts`). Valores inválidos voltam ao default e geram aviso.

Ajuste por `/config` (linha `jev-orchestrator.<campo>`) ou `pluginConfigs["jev-orchestrator"].options` nas settings.

| Campo | Tipo | Padrão | Opções | Descrição |
|---|---|---|---|---|
| `language` | string | `auto` | `auto`, `en`, `pt-BR` | idioma das mensagens do plugin; auto: segue o idioma do Claude Code (ou o locale) e cai para `en` |
| `mode` | string | `auto` | `auto`, `off`, `explicit` | auto: o JEV decide; off: desligado; explicit: só `[jev]`; também muda com `/jev-orc` |
| `maxModel` | string | `opus` | `haiku`, `sonnet`, `opus` | o modelo mais forte que o JEV pode escolher para um subagente |
| `maxEffort` | string | `xhigh` | `low`..`max` | o maior effort que o JEV pode escolher, para subagentes e (`mainEffort`) os seus prompts |
| `mainEffort` | boolean | `false` | | o JEV define o effort dos seus próprios prompts; o modelo da sessão fica |
| `multiModel` | boolean | `false` | | um segundo modelo, mais forte, revisa tarefas difíceis em que o JEV está inseguro (verificador) |
| `compareModel` | string | `auto` | `auto`, `haiku`, `sonnet`, `opus`, `fable` | modelo contra o qual a status line precifica os tokens roteados; auto: o modelo da sua sessão. Muda só a status line, não o roteamento |
| `statusStyle` | string | `nerd` | `nerd`, `plain` | nerd: ícones Nerd Font e separadores `│` (exige uma Nerd Font no terminal); plain: só texto, o formato anterior |
| `typesafeApiKey` | string (sensível) | — | | chave do JEV (TypeSafe, ou OpenRouter com o endpoint do OpenRouter), guardada no Keychain e definida em `/plugin` → Installed → jev-orchestrator → Configure options; precedência: `typesafeApiKey` → `TYPESAFE_API_KEY` → `JEV_API_KEY`; vazia ou só espaços conta como ausente |
| `jevEndpoint` | string | `https://api.typesafe.ai/v1/systemone` | URL https | API System One; para o OpenRouter, `https://openrouter.ai/api/v1/systemone` com uma chave do OpenRouter em `typesafeApiKey`; o que não for https volta ao padrão |
| `logLevel` | string | `info` | `off`, `info`, `debug` | nível do log de decisões |

## Valores fixos

Deixaram de ser opções; se um dia precisar, mude em `src/config.ts`.

| Valor | Fixo em |
|---|---|
| Tipos de agent interceptados | `general-purpose`, `Explore` |
| Agents roteados ativos | no máximo 8; acima disso, fallback |
| Consultas simultâneas ao JEV | 4 |
| Timeout do JEV | 8000 ms (o hook tem 10 s) |
| Fallback quando o JEV falha | `sonnet` · `medium` · todos os grupos de tools, limitado por `maxModel`/`maxEffort` |
| Preços (US$/MTok, input/output/cache read/cache write) | haiku 0.1/0.5/0.01/0.125 · sonnet 2/10/0.2/2.5 · opus 4/20/0.2/5 |

## Como os máximos se aplicam

- Um nível de modelo do JEV acima de `maxModel` cai para `maxModel`; um nível abaixo é mantido.
- Um effort do JEV acima de `maxEffort` cai para `maxEffort`, qualquer que seja o modelo.
- Com `multiModel`, o verificador é o modelo mais forte até `maxModel` que não seja o principal.
