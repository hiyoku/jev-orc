# Troubleshooting

## O plugin não carrega

```bash
claude plugin validate <repo>
claude --plugin-dir <repo> --debug-file ~/jev-debug.log
```

Procure no debug log por erros de `jev-orchestrator` ou `hooks`. Ao carregar, a status line mostra
`jev ON` (ou `jev OFF`). Avisos de config aparecem como toast e vêm de valores inválidos (veja
[configuration.md](configuration.md)).

## O JEV sempre cai em fallback

Leia o campo `error` das linhas `outcome: "fallback"` do log:

```bash
tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl | jq -c 'select(.outcome=="fallback") | {error,reasons}'
```

| `error` | Causa |
|---|---|
| `missing_key` | `TYPESAFE_API_KEY`/`JEV_API_KEY` ausente no ambiente do `claude` |
| `timeout` | o JEV não respondeu em `jevTimeoutMs` (máximo 9000) |
| `network` | falha de rede ou `jevEndpoint` errado |
| `http_<status>` | resposta HTTP de erro (ex.: `http_401`: chave inválida) |
| `bad_payload` | resposta do JEV fora do formato esperado |

Sem `error` e com `reasons` como `maxAgents` ou `parallelism`, o limite de agents ou a fila do JEV foi atingido.

## Uma tool esperada não aparece no perfil

- Os perfis são registrados no `session.start` e restringem as tools por nome ou por prefixo de
  servidor MCP (ex.: `mcp__context7__*`). Por isso uma tool MCP que conecta depois do início
  da sessão já fica coberta pelo perfil; o engine é quem aplica a restrição.
- `toolsAllow` não vazio restringe os perfis a esses nomes; `toolsDeny` vence `toolsAllow` e vira
  `disallowedTools` em todos os perfis. Uma mudança de config recarrega o módulo e refaz os perfis.
- A tool só entra se o grupo escolhido pelo JEV a inclui e se o servidor MCP dela está conectado.

## Permissões no headless (`claude -p`)

- Comandos Bash compostos (pipes, aspas) são negados; comandos só de leitura simples passam.
- Ler o log fora do cwd exige regra de permissão, por exemplo (settings):

```json
{
  "permissions": {
    "allow": [
      "Read(~/.claude/jev-orchestrator/**)",
      "Bash(tail -n * ~/.claude/jev-orchestrator/decisions.jsonl)"
    ]
  }
}
```

Isso não é falha do MOD; sem a regra, a skill `/jev-dispatcher` não consegue ler o log no `-p`.

## A status line mostra `?` ou `<$0.001`

- `vs <modelo>/?`: o MOD ainda não viu um turno do loop principal com effort; passa no primeiro turno seguinte.
  `vs ?/…` indica que o modelo do usuário não é haiku, sonnet nem opus.
- `<$0.001`: a estimativa é menor que US$ 0,0005 (arredondaria para `$0.000`). Sem `~` e
  porcentagem, não há contrafactual (modelo do usuário desconhecido ou verificador).
