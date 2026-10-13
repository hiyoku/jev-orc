# Troubleshooting

🌐 [English](troubleshooting.md) · Português (Brasil)

## O plugin não carrega

```bash
claude plugin validate <repo>
claude --debug-file ~/jev-debug.log   # com o plugin instalado pelo marketplace
```

Procure no debug log por erros de `jev-orchestrator` ou `hooks`. Ao carregar, a status line mostra
`jev ON` (ou `jev OFF`). Avisos de config aparecem como toast e vêm de valores inválidos (veja
[configuration.md](configuration.pt-BR.md)).

## O JEV sempre cai em fallback

Leia o campo `error` das linhas `outcome: "fallback"` do log:

```bash
tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl | jq -c 'select(.outcome=="fallback") | {error,reasons}'
```

| `error` | Causa |
|---|---|
| `missing_key` | opção `typesafeApiKey` vazia (`/plugin` → Installed → jev-orchestrator → Configure options) e `TYPESAFE_API_KEY`/`JEV_API_KEY` ausentes no ambiente do `claude` |
| `timeout` | o JEV não respondeu em 8 s |
| `network` | falha de rede ou `jevEndpoint` errado |
| `http_<status>` | resposta HTTP de erro (ex.: `http_401`: chave inválida) |
| `bad_payload` | resposta do JEV fora do formato esperado |

Sem `error` e com `reasons` como `maxAgents` ou `parallelism`, o limite de agents (8) ou a fila do JEV (4) foi atingido.

## Uma tool esperada não aparece no perfil

- Os perfis são registrados no `session.start` e restringem as tools por nome ou por prefixo de
  servidor MCP (ex.: `mcp__context7__*`). Por isso uma tool MCP que conecta depois do início
  da sessão já fica coberta pelo perfil; o engine é quem aplica a restrição.
- A tool só entra se o grupo escolhido pelo JEV a inclui e se o servidor MCP dela está conectado.

## Permissões no headless (`claude -p`)

- Comandos Bash compostos (pipes, aspas) são negados; comandos só de leitura simples passam.
- Ler o log fora do cwd exige regra de permissão, por exemplo (settings):

```json
{
  "permissions": {
    "allow": [
      "Read(~/.claude/jev-orchestrator/**)",
      "Bash(tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl)"
    ]
  }
}
```

A regra usa o valor exato `20` em vez de `*` de propósito: o Claude Code avisa sobre regra com "a wildcard before the rest of the command", pois o `*` também casa com opções inseridas e as aprovaria sem prompt. Se usar outro N, adicione uma regra por valor.

Isso não é falha do MOD; sem a regra, uma sessão `-p` não consegue ler o log.

## A status line mostra `?` ou `<$0.001`

- `vs <modelo>/?`: o MOD ainda não viu um turno do loop principal com effort; passa no primeiro turno seguinte.
  `vs ?/…` indica que o modelo do usuário não é haiku, sonnet nem opus.
- `<$0.001`: a estimativa é menor que US$ 0,0005 (arredondaria para `$0.000`). Sem `~` e
  porcentagem, não há contrafactual (modelo do usuário desconhecido ou verificador).
