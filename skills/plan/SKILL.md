---
name: plan
description: Turns a request into docs/dev/NNN_<ShortDescription>/ with a prompt.md (full prompt, task map, dependencies, parallel waves) and one numbered file per task, cut small enough for cheaper models. Writes only; /jev-orchestrator:run executes it. Use when the user calls /jev-orchestrator:plan or asks to "plan this into tasks".
argument-hint: <request>
---

# Plan

Request: $ARGUMENTS

You only write files. Nothing is executed here, and no task names a model or an effort:
JEV picks those when /jev-orchestrator:run spawns each task, reading only the task text.
Your job is the cut: every task must read as mechanical (haiku), with every input in the
text, so the agent executes without deciding or researching.

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
## Constraints    <!-- what must not change, project rules, known environment breakage + the verify command that works (e.g. `tsc -p .` fails, bare `tsc` emits stray .js: use `tsc --noEmit`) -->
## Done when      <!-- verifiable criteria, how to check -->

## Tasks
| # | Task | Nature | Size (files/lines) | File | Depends on |
|---|------|--------|--------------------|------|------------|
| 01 | ... | reads / edits files / changes git | 1 / ~20 | 01_<name>.md | - |

## Execution
- Wave 1: 01, 03   <!-- run in parallel -->
- Wave 2: 02       <!-- after 01 -->
```

## 4. Task size (golden rule: it must fit haiku)

One task = one verifiable change, in 1 to 3 files at most, described down to signature or
line level. JEV scores a task mechanical only when "the exact change is already stated".
Split when any holds:
- more than 3 files, or more than ~60 diff lines expected;
- more than one verifiable behavior;
- the body says "refactor", "improve", "investigate", "understand how X works", or leaves a
  design choice open.

Understanding or a design decision becomes its own **report-only** task, or you decide it
now and write the decision into the task. Never leave it inside an editing task.

Cut by layer, each its own task: types/constants, pure logic, tests, callers, docs, opening
the PR. Keep a test with its logic only when the test fits in ~20 lines.

## 5. Task content

One file per task, `NN_<name>.md`. The agent sees only this file, a short context the runner cuts from prompt.md, and what its
dependencies delivered, so everything it needs is in the file:
- exact paths; exact code or signatures to write, not descriptions of them;
- names, values and constants already decided;
- the exact verification command and its expected output;
- what must not be touched;
- the exact commit command with the explicit path list (never `git add -A` or `.`), when the
  task commits;
- what it expects from earlier tasks, under **Inputs**.

Rules learned from real runs:
- **State the nature first.** Say on the first lines whether the task reads only, creates,
  edits or deletes files, or changes git state (branch, commit, push), with the exact file
  list. JEV routes on the text: a git or edit task that does not say so gets a read-only
  profile and fails.
- **Skills, web and MCP are out of reach for the agent.** Isolate any step needing a skill,
  web search or MCP tool in a **report-only** task (the runner does it), or embed the data
  needed in the task text. Never make an editing task depend on one.
- **Subagents cannot write report files.** Research and report tasks return the result in
  the final text; the dependent task lists it under Inputs (run passes on what the
  dependencies delivered). Do not point tasks at a report file.
- **Shared tree.** Tasks in one wave never touch the same file, and each commits only its
  own explicit paths.

Template:

```markdown
depends_on: [..]
# NN <title>
**Nature:** reads only | edits files | changes git
**Files:** closed list, one path per line (create / edit / delete)
## Inputs          <!-- what it receives from earlier tasks, or "none" -->
## Steps           <!-- numbered, mechanical -->
## Exact code/text <!-- the snippets to write -->
## Verification    <!-- command + expected output -->
## Do not          <!-- files and behaviors off-limits -->
## Commit          <!-- exact command with explicit paths, or "no commit" -->
## Done when
```

## 6. Waves

A task goes in the first wave after all its dependencies. Maximize parallelism among small
tasks on disjoint files; report-only tasks come first. Tasks that touch the same file never
share a wave: add a dependency between them.

## 7. Check the plan, then close

Before closing, confirm each point and fix the plan when one fails:
- [ ] no task breaks section 4 (size, behaviors, forbidden words);
- [ ] every task has Nature, Files, Verification and a commit line;
- [ ] none needs a skill, web or MCP without a prior report-only task;
- [ ] dependencies have no cycle, and each Input names its source task;
- [ ] no two tasks of one wave share a file;
- [ ] prompt.md Constraints lists the known environment breakage and the working verify command.

Tell the user the folder, the task table (Nature and estimated size per task) and the waves,
and that `/jev-orchestrator:run NNN` executes it.
