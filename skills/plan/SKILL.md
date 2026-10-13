---
name: plan
description: Turns a request into docs/dev/NNN_<ShortDescription>/ with a prompt.md (full prompt, task map, dependencies, parallel waves) and one numbered file per task, cut small enough for cheaper models. Writes only; /jev-orchestrator:run executes it. Use when the user calls /jev-orchestrator:plan or asks to "plan this into tasks".
argument-hint: <request>
---

# Plan

Request: $ARGUMENTS

You only write files. Nothing is executed here, and no task names a model or an effort:
JEV picks those when /jev-orchestrator:run spawns each task. Your job is the cut, because
well-cut tasks are what let JEV route to haiku or sonnet.

Write the files in the user's language.

## 1. Understand

Read the code the request touches before cutting. A trivial request (one line, one question)
needs no plan: say so and stop.

## 2. Folder

`docs/dev/NNN_<ShortDescriptionInPascalCase>/`, where NNN is the highest numeric prefix in
`docs/dev/` plus 1, zero-padded to 3 digits (001 when there is none). Entries without a
numeric prefix (`cost-analysis.md`, `known-limits.md`) are ignored.
`docs/dev/` is ignored by git: the plan is local and never committed.

## 3. prompt.md

The prompt you build from the request, complete enough that someone with no access to this
conversation can run it:

```markdown
# <Title>

## Goal
## Context        <!-- stack, files involved, current behavior -->
## Constraints    <!-- what must not change, project rules -->
## Done when      <!-- verifiable criteria, how to check -->

## Tasks
| # | Task | File | Depends on |
|---|------|------|------------|
| 01 | ... | 01_<name>.md | - |
| 02 | ... | 02_<name>.md | 01 |

## Execution
- Wave 1: 01, 03   <!-- run in parallel -->
- Wave 2: 02       <!-- after 01 -->
```

## 4. Tasks

One file per task, `NN_<name>.md`, starting with `depends_on: [..]` frontmatter (empty list
when none). Each task:

- **Stands alone.** The agent sees only this file and prompt.md. List the files, what to
  change, the done criterion and how to verify it.
- **One verifiable result.** Do not split what is a single change; do not merge unrelated
  changes.
- **Mechanical when possible.** Push the design decisions into the task text (names,
  signatures, where things go) so the agent executes instead of deciding. Leave a task
  open-ended only when the decision really cannot be made upfront; JEV will route it up.

## 5. Waves

A task goes in the first wave after all its dependencies. Tasks that touch the same files
never share a wave: add a dependency between them.

## 6. Close

Tell the user the folder, the task table and the waves, and that
`/jev-orchestrator:run NNN` executes it.
