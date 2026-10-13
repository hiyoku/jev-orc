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
   - `prompt`, in this order (JEV reads only the first 4000 characters, so the task goes first):
     1. the task file, whole;
     2. what the tasks it depends on delivered (the results they reported), under "Inputs";
     3. "Context", taken from prompt.md and cut to what THIS task needs: the Goal in one
        line, plus only the Constraints and environment notes that apply to this task's
        files and commands. Never paste prompt.md whole, and leave out the task table, the
        waves and the other tasks;
     4. "When done, report what changed (file:line) and the verification result."
     Keep the whole prompt well under 4000 characters; trim Context first, never the task.
3. Wait for the wave. A failed task: stop before the waves that depend on it and tell the
   user; independent waves go on.
4. Check the results yourself (run the tests when there are any). Report per task:
   done / failed / skipped. Commits follow the user's and the project's rules, and only when
   asked.
