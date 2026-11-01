---
name: slice
description: Sizes a piece of work and finishes it with proof from the running app. A small ticket is done in the current session, changed, checked with the project's verify recipe and committed only after the evidence is shown; bigger work goes through /slice:shape and /slice:run. Also holds the builder routine for unattended run sessions. Use when starting or finishing a change in a repo set up with slice (.claude/slice.json).
when_to_use: Fix, implement, build a feature, "ultracode", before a commit or PR, "ist das fertig", "fertig melden", "Ticket", "Feature bauen", SLICE_RUN=1.
---
Active only when `.claude/slice.json` exists in the repo. Otherwise ignore this skill.

## Verdict
The only verdict on "done" is an end-to-end run against the running app with real data, shown in the conversation after the last code change. Unit tests, linters and reviews help; they never decide.

## Small ticket: do it here
One place, clear outcome. Work in this session, no `.slice` files, no plan or notes file.
1. Make the change.
2. Invoke the `verify` skill (`.claude/skills/verify/SKILL.md`) and run its recipe against the running app. Show the evidence: commands and output, a screenshot for UI.
3. Fix and repeat on failure. Commit only after the evidence is shown.

If the repo has no verify recipe, run `/run-skill-generator` or run `/verify` once so one gets recorded, then continue.

## Bigger work
Several files, screens, data or core paths, or the person says "ultracode": suggest `/slice:shape` to plan it, then `/slice:run` to build it unattended. Do not start a big build in this session unasked.

## In a run session (SLICE_RUN=1)
You build every feature in `.slice/features.json` in one long session. Decide reversible questions yourself; never wait for the person.
1. Read `.slice/progress.md`, `git log --oneline -20` and `.slice/features.json`.
2. Start the app via the verify recipe and run a short E2E check that it still works. Fix a broken state first.
3. Take the first feature with `passes` false and build it.
4. Run its E2E steps with the verify skill and show evidence (commands and output, a screenshot for UI). Judge UI against the `taste` skill criteria. On failure fix and repeat.
5. Only then set `passes` to true, update `.slice/progress.md` (newest first: done, next, blockers) and commit `slice: <id> <title>`.
6. Take the next feature. When all pass, run the `slice:verifier` agent (spec review, skip style) and `/code-review` on the run diff, fix what holds, then run every feature's E2E steps once more with evidence.

Never edit anything in `features.json` but `passes`. A feature you cannot finish: write the reason in `progress.md`, leave `passes` false and continue with the next.

## Scope
Do what was asked; everything else becomes a suggestion in the report. Comments only for a non-obvious why. Debugging: reproduce first, then find the cause, then fix. Decisions the person owns (direction, stack, architecture, UX): suggest, never decide silently.
