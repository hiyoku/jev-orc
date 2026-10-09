# Configuração

Fonte única: `userConfig` em `.claude-plugin/plugin.json`. Em caso de divergência, vale o código
(`src/config.ts`). Valores inválidos voltam ao default e geram aviso; o plano está em
`docs/000_init_project/03_config.md`.

Ajuste por `/config` (linha `jev-orchestrator.<campo>`) ou `pluginConfigs["jev-orchestrator"].options` nas settings.

| Campo | Tipo | Default | Opções | Descrição |
|---|---|---|---|---|
| `mode` | string | `auto` | `auto`, `off`, `explicit` | auto: JEV decide; off: desligado; explicit: só `[jev]` |
| `effortsHaiku` | lista | `low`, `medium` | `low`..`max` | efforts permitidos com haiku; vazio desabilita o haiku |
| `effortsSonnet` | lista | `low`, `medium`, `high` | `low`..`max` | idem, sonnet |
| `effortsOpus` | lista | `medium`, `high`, `xhigh` | `low`..`max` | idem, opus |
| `fallbackOrder` | lista | `sonnet`, `opus`, `haiku` | modelos | ordem tentada quando o escolhido está desabilitado |
| `agentsIntercept` | lista | `general-purpose`, `Explore` | tipos de agent | tipos que o mod reescreve; os demais passam intocados |
| `agentsTarget` | lista | `explore`, `general` | `explore`, `general` | perfis para os quais o mod pode transicionar |
| `forceModel` | string | `jev` | `jev`, `haiku`, `sonnet`, `opus` | `jev`: o JEV decide |
| `forceEffort` | string | `jev` | `jev`, `low`..`max` | effort fixo para qualquer perfil |
| `forceEffortExplore` | string | `jev` | idem | effort fixo só no perfil explore |
| `forceEffortGeneral` | string | `jev` | idem | effort fixo só no perfil general |
| `forceAgent` | string | `jev` | `jev`, `explore`, `general` | perfil fixo |
| `forceTools` | lista | `[]` | nomes de tools | tools fixas; vazio: o JEV decide |
| `fallbackModel` | string | `sonnet` | `haiku`, `sonnet`, `opus` | modelo quando o JEV falha |
| `fallbackEffort` | string | `medium` | `low`..`max` | effort quando o JEV falha |
| `fallbackAgent` | string | `general-purpose` | livre | tipo de agent quando o JEV falha |
| `multiModel` | boolean | `false` | | permite modelos diferentes na mesma tarefa (verificador) |
| `maxModelsPerTask` | number | `1` | inteiro >= 1 | máximo de modelos por tarefa |
| `maxAgents` | number | `8` | inteiro >= 1 | máximo de agents roteados ativos |
| `parallelism` | number | `4` | inteiro >= 1 | consultas ao JEV simultâneas |
| `toolsAllow` | lista | `[]` | nomes ou prefixo `*` | tools que o JEV pode atribuir; vazio: sem restrição |
| `toolsDeny` | lista | `[]` | nomes ou prefixo `*` | tools nunca atribuídas |
| `jevTimeoutMs` | number | `8000` | inteiro 1..9000 | espera máxima pelo JEV |
| `jevEndpoint` | string | `https://api.typesafe.ai/v1/systemone` | URL | API do JEV |
| `logLevel` | string | `info` | `off`, `info`, `debug` | nível do log de decisões |
| `priceHaiku` | string | `0.1,0.5,0.01,0.125` | `input,output,cacheRead,cacheWrite` | US$/MTok (cache write de 5 min) |
| `priceSonnet` | string | `2,10,0.2,2.5` | idem | idem |
| `priceOpus` | string | `4,20,0.2,5` | idem | idem |
| `jevPricePerCall` | number | `0` | >= 0 | US$ por chamada ao JEV, somado ao custo real da status line |

Listas aceitam `low`, `medium`, `high`, `xhigh`, `max` para efforts. `*` só vale no fim do padrão
(`mcp__context7__*`).

## Regras de validação

- Lista `efforts*` vazia desabilita o modelo. Todas vazias, ou `agentsTarget` vazio: `mode=off` com aviso.
- Valores desconhecidos em listas (`fallbackOrder`, `agentsTarget`, `efforts*`) são descartados com aviso.
- `fallbackModel` desabilitado: usa o primeiro habilitado de `fallbackOrder`; `fallbackEffort` fora
  do permitido do modelo desce ao maior effort permitido abaixo dele (ou ao menor permitido).
- Precedência dos force: `forceEffortExplore`/`forceEffortGeneral` (do perfil resolvido) vencem `forceEffort`.
  Um force fora do espaço habilitado (modelo desabilitado, effort fora de `efforts*`, perfil fora de
  `agentsTarget`) é ignorado, e o JEV decide.
- `forceTools` passa por `toolsDeny` (as negadas são removidas, com aviso) e pelo catálogo de tools
  disponíveis. `toolsDeny` vence `toolsAllow`.
- Se os force cobrem model, agent, effort e tools, o JEV nem é consultado.
- `jevTimeoutMs` acima de 9000 (ou não inteiro) é inválido e volta a 8000: o hook tem 10 s e o
  timeout sai desse orçamento.
- Preço inválido (não são 4 números >= 0) volta ao default com aviso.
