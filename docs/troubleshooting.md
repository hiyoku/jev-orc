# Troubleshooting

🌐 English · [Português (Brasil)](troubleshooting.pt-BR.md)

## The plugin does not load

```bash
claude plugin validate <repo>
claude --debug-file ~/jev-debug.log   # with the plugin installed from the marketplace
```

Look in the debug log for `jev-orchestrator` or `hooks` errors. On load, the status line shows
`jev ON` (or `jev OFF`). Config warnings appear as a toast and come from invalid values (see
[configuration.md](configuration.md)).

## JEV always falls back

Read the `error` field of the `outcome: "fallback"` lines in the log:

```bash
tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl | jq -c 'select(.outcome=="fallback") | {error,reasons}'
```

| `error` | Cause |
|---|---|
| `missing_key` | `typesafeApiKey` option empty (`/plugin` → Installed → jev-orchestrator → Configure options) and `TYPESAFE_API_KEY`/`JEV_API_KEY` missing from the `claude` environment |
| `timeout` | JEV did not answer within 8 s |
| `network` | network failure or wrong `jevEndpoint` |
| `http_<status>` | HTTP error response (e.g., `http_401`: invalid key) |
| `bad_payload` | JEV response outside the expected format |

With no `error` and `reasons` such as `maxAgents` or `parallelism`, the agent limit (8) or the JEV queue (4) was reached.

## An expected tool does not appear in the profile

- Profiles are registered at `session.start` and restrict tools by name or by MCP server prefix
  (e.g., `mcp__context7__*`). So an MCP tool that connects after the session starts is already
  covered by the profile; the engine is what enforces the restriction.
- The tool only gets in if the group JEV chose includes it and its MCP server is connected.

## Permissions in headless mode (`claude -p`)

- Compound Bash commands (pipes, quotes) are denied; simple read-only commands pass.
- Reading the log outside the cwd requires a permission rule, for example (settings):

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

The rule uses the exact value `20` instead of `*` on purpose: Claude Code warns about a rule with "a wildcard before the rest of the command", because `*` also matches inserted options and would approve them without a prompt. If you use another N, add one rule per value.

This is not a MOD failure; without the rule, a `-p` session cannot read the log.

## The status line shows `?` or `<$0.001`

- `vs <model>/?`: the MOD has not yet seen a main-loop turn with effort; it resolves on the next turn.
  `vs ?/…` means the user's model is not haiku, sonnet, or opus.
- `<$0.001`: the estimate is below US$ 0.0005 (it would round to `$0.000`). Without `~` and a
  percentage, there is no counterfactual (unknown user model or verifier).
