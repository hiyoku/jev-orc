---
name: run
description: Executes a plan written by /jev-orchestrator:plan - reads docs/dev/NNN_*/prompt.md (falling back to docs/NNN_*/prompt.md for older plans) and spawns one agent per task, wave by wave, each routed by JEV. Use when the user calls /jev-orchestrator:run or asks to "run plan NNN".
argument-hint: <NNN>
---

# Run

Plan: $ARGUMENTS (the NNN prefix; the latest numbered folder in `docs/dev/` when empty (then `docs/`)).

1. Read `docs/dev/NNN_*/prompt.md`. If it does not exist, read `docs/NNN_*/prompt.md` (older
   plans such as 001 and 002). Its Execution section is the order.
2. For each wave, spawn every task of the wave in the same response, one `Agent` call each:
   - `subagent_type: general-purpose`, **no `model` and no `effort`**: JEV picks them.
   - `description`: `[jev] NN <task>` (the prefix routes it in explicit mode too).
   - `prompt`: the content of prompt.md, then the task file, then what the tasks it depends
     on delivered, then "When done, report what changed (file:line) and the verification
     result."
3. Wait for the wave. A failed task: stop before the waves that depend on it and tell the
   user; independent waves go on.
4. Check the results yourself (run the tests when there are any). Report per task:
   done / failed / skipped. Commits follow the user's and the project's rules, and only when
   asked.
