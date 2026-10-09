# compat

Camada de compatibilidade para manter o nome exato `/jev-dispatcher`. Fica fora de `skills/`
para não virar `jev-orchestrator:jev-dispatcher`, e fora dos componentes do plugin.

## Instalar (após validação real, tarefa 13)

A skill só roteia com o plugin instalado pelo marketplace (veja o README da raiz).

```bash
mv ~/.claude/skills/jev-dispatcher ~/.claude/skills/jev-dispatcher.bak-$(date +%Y%m%d)
ln -s <repo>/compat/jev-dispatcher ~/.claude/skills/jev-dispatcher
```

## Reverter

```bash
rm ~/.claude/skills/jev-dispatcher   # remove só o symlink
mv ~/.claude/skills/jev-dispatcher.bak-<data> ~/.claude/skills/jev-dispatcher
```
