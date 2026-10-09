# JEV Orchestrator

MOD (plugin) do Claude Code 2.1.294 que roteia cada spawn de `Agent` pelo JEV (TypeSafe). O JEV
decide o modelo (haiku, sonnet, opus), o effort e o perfil de tools de cada subagente.

## Fluxo

```mermaid
flowchart LR
  A["Agent (tool.call)"] --> B{"mode e tipo<br/>interceptados?"}
  B -- nao --> Z["passa intocado"]
  B -- sim --> C["JEV decide"]
  C -- falhou --> F["fallback<br/>(fallbackModel/Effort)"]
  C --> D["tool.call aplica o effort"]
  F --> D
  D --> E["agent.spawn aplica<br/>model + perfil de tools"]
```

- `tool.call` (Agent) consulta o JEV e aplica o effort.
- `agent.spawn`, correlacionado por `tool_use_id`, aplica o modelo e o perfil de tools.
- Fail-open: o MOD nunca nega um spawn. Se o JEV falha (chave ausente, timeout, rede, `http_*`), o
  spawn segue com `fallbackModel`/`fallbackEffort`/`fallbackAgent` e o motivo vai para o log.

## Instalação

Somente pelo marketplace. Numa sessão do Claude Code:

```
/plugin marketplace add hiyoku/jev-orc
/plugin install jev-orchestrator@jev-orchestrator
```

O segundo comando abre os detalhes do plugin; escolha o escopo (usuário, projeto ou local).

## Chave do JEV

O Claude Code oferece o diálogo de opções do plugin quando ele é habilitado pela primeira vez:
preencha **TypeSafe / JEV API key** (`typesafeApiKey`). Para definir ou trocar depois, abra
`/plugin` → **Installed** → `jev-orchestrator` → **Configure options**.

O campo é `sensitive`: a chave fica no armazenamento seguro do sistema (Keychain no macOS), não no
`settings.json`, e não aparece no `/config`. Com o campo vazio, vale a variável de ambiente
`TYPESAFE_API_KEY` (ou `JEV_API_KEY`) de quem executa o `claude`. A chave nunca vai para o log, a
status line, os toasts ou as mensagens de erro. Sem chave nenhuma, todo spawn roteado cai no
fallback (com um toast).

## Modos

| `mode` | Comportamento |
|---|---|
| `auto` (padrão) | o JEV decide cada spawn dos tipos em `agentsIntercept` |
| `off` | desligado; a status line mostra `jev OFF` |
| `explicit` | só roteia spawns cuja `description` começa com `[jev]` (o marcador é removido) |

Ligar e desligar pelo comando `/jev-orc`:

| Comando | Efeito |
|---|---|
| `/jev-orc` | alterna `auto` ⇄ `off` (de `explicit` vai para `off`) |
| `/jev-orc on` / `off` / `explicit` | grava `auto` / `off` / `explicit` |
| `/jev-orc status` | mostra o modo e a status line, sem gravar |

Para escolher `model`/`effort` à mão, desligue com `/jev-orc off`; vale a partir do próximo spawn.

Ou: `/config`, linha `jev-orchestrator.mode`; ou nas settings:

```json
{ "pluginConfigs": { "jev-orchestrator": { "options": { "mode": "off" } } } }
```

Todos os campos estão em [docs/configuration.md](docs/configuration.md).

**Atenção:** num spawn roteado, o MOD sobrescreve o `model` e o `effort` passados à mão. Para
escolher manualmente, desligue (`mode=off`) ou use `explicit` e chame sem o marcador `[jev]`.
Também é possível fixar valores com `forceModel`/`forceEffort`.

## Status line

```text
jev ON · haiku·low·t-read · 42k tok $0.08 · vs opus/high ~$0.31 (-74%)
jev OFF
```

- `haiku·low·t-read`: último roteamento (modelo, effort, perfil); em falha, `fallback (<motivo>)`.
- `42k tok $0.08`: tokens e custo real dos agents roteados na sessão (mais `jevPricePerCall` por
  chamada ao JEV).
- `vs opus/high`: modelo e effort do usuário. O effort fica `?` até o MOD ver um turno do loop principal.
- `~$0.31 (-74%)`: **estimativa**. O contrafactual são os mesmos tokens no modelo do usuário; não
  modela quanto o effort muda a contagem de tokens. `+x%` indica que o roteado saiu mais caro.
  Estimativa abaixo de US$ 0,0005 aparece como `<$0.001`.
- `logLevel` não afeta a status line.

Os preços vêm de `priceHaiku/Sonnet/Opus` (US$/MTok).

## Log de decisões

`~/.claude/jev-orchestrator/decisions.jsonl`, uma linha JSON por decisão. Campos:

| Campo | Conteúdo |
|---|---|
| `ts` | ISO 8601 |
| `tool_use_id` | id da chamada de Agent |
| `description` | descrição, sem o marcador `[jev]` |
| `outcome` | `routed`, `fallback`, `skip` ou `verifier` |
| `models` | modelos (o segundo é o verificador, se houver) |
| `effort`, `profile` | decisão aplicada |
| `reasons` | por que cada escolha foi feita |
| `jev` | números crus do JEV (scores, `*_confidence`, `deliberation`) |
| `error` | `missing_key`, `timeout`, `network`, `bad_payload` ou `http_<status>` |
| `jev_request` | só com `logLevel=debug`: tarefa truncada em 200 caracteres e contexto |

Nunca é gravado: a chave de API, o prompt completo, mensagens e resultados de tools.
Rotação: ao passar de 1 MiB, o arquivo vira `decisions.1.jsonl` (uma geração). `logLevel=off`
desliga o log.

```bash
tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl
tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl | jq -c 'del(.ts,.tool_use_id)'
```

O log fica fora do repo e não é versionado (`.gitignore`: `decisions*.jsonl`).

## Multi-modelo (opcional)

Desligado por padrão (`multiModel=false`). Ligado, com `maxModelsPerTask >= 2`, um verificador
revisa a resposta quando a complexidade é de nível opus e a confiança do JEV está abaixo de 0.5.
O verificador roda no perfil só de leitura `jev-orchestrator:t-read`. Na validação, o corte de
confiança 0.5 quase nunca foi atingido (confiança ≥ 0.69 mesmo para pedidos vagos), então o
verificador não disparou. A recalibração será feita com dados do log (decisão do usuário).

## Mais

- [Configuração](docs/configuration.md)
- [Limites conhecidos](docs/known-limits.md)
- [Troubleshooting](docs/troubleshooting.md)
