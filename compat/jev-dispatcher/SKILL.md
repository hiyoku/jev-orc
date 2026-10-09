---
name: jev-dispatcher
description: Quebra o pedido do usuário em tarefas e dispara um subagente por tarefa; o modelo, o effort e as ferramentas de cada um são decididos pelo MOD jev-orchestrator, não por esta skill. Use quando o usuário chamar /jev-dispatcher ou pedir para "rotear com o Jev" / "disparar agentes pelo Jev".
argument-hint: <pedido>
---

# Jev dispatcher

O usuário pediu explicitamente que o trabalho seja feito por subagentes roteados pelo Jev.
Quem quebra o pedido em tarefas é você; o roteamento (modelo, effort, perfil de tools) é do MOD.

Pedido: $ARGUMENTS

## 1. Quebrar em tarefas

- Leia o código que o pedido toca antes de quebrar. Tarefa mal recortada = agente perdido.
- Cada tarefa precisa se sustentar sozinha: o subagente começa sem o seu contexto. Diga
  arquivos, o que mudar, o critério de pronto e como verificar.
- Uma tarefa = um resultado verificável. Não quebre o que é uma mudança só.
- Marque dependências (`depende_de`). Tarefas que mexem nos mesmos arquivos não rodam juntas.
- Pedido trivial (uma linha, uma pergunta)? Não quebre, faça você mesmo e diga por quê.

## 2. Disparar

Uma chamada `Agent` por tarefa, com a `description` prefixada por `[jev]` (necessário em
`mode=explicit`, inofensivo em `auto`). Não passe `model` nem `effort`: o MOD decide.
No `prompt`: o texto da tarefa + "Ao terminar, relate o que mudou (arquivo:linha) e o
resultado da verificação."

Tarefas sem dependência pendente saem juntas, na mesma resposta. As dependentes saem em
ondas, quando as anteriores terminarem, levando no prompt o que a anterior entregou.

## 3. Fechar

Confira o resultado de cada agente (rode os testes você mesmo quando houver). Relate ao
usuário por tarefa: feito / falhou / pulado, com o modelo e o effort usados. Esses valores
vêm do resultado do agente e do log do MOD (`tail -n 20 ~/.claude/jev-orchestrator/decisions.jsonl`). Commits seguem
as regras do usuário e do projeto, e só se ele pediu.

## 4. Se o MOD não estiver carregado

Sem perfis `jev-orchestrator:*` disponíveis, ou se o usuário avisar que o MOD está fora:
diga isso ao usuário e siga com o fallback, passando explicitamente em cada `Agent`
`model: sonnet`, `effort: medium` e `subagent_type: general-purpose`.
