---
name: slice
description: Builder routine for unattended /slice:run sessions. Builds every feature in .slice/features.json one at a time and proves each one end to end against the running app before marking it passed. Use when working in a run session (SLICE_RUN=1) in a repo set up with slice (.claude/slice.json).
when_to_use: SLICE_RUN=1, /slice:run builder session, .slice/features.json.
user-invocable: false
---
Active only in a run session (`SLICE_RUN=1`). Otherwise ignore this skill.

## Verdict
The only verdict on "done" is an end-to-end run against the running app with real data, shown in the conversation after the last code change. Unit tests, linters and reviews help; they never decide.

## How to run the app
Use the project's `verify` skill (`.claude/skills/verify/SKILL.md`) or a `run-<name>` skill if the repo has one. Otherwise start the app yourself from the README, `Makefile` or package scripts. CLI and servers: Bash. Anything with screens: the Playwright browser tools (navigate, interact, read the page, take a screenshot). Start servers in the background on a fixed port and stop them when done. You cannot write inside `.claude/`; if the recorded recipe is wrong, write the fix to `.slice/progress.md` under `## Recipe changes`.

## Routine
You build every feature in `.slice/features.json` in one long session. Never wait for the person.
1. Read `.slice/progress.md`, `git log --oneline -20`, `.slice/spec.md` (with its `## Quality bar`) and `.slice/features.json`. Invoke the `practices` skill and load its `references/code.md`, the cookbook for the type the spec names, and in a new app its `references/architecture.md`. After a resume or a compaction, do this again first.
2. Before changing any code, start the app and run the E2E steps on the code as it is. Show the output. If a feature's steps already fail on existing code, say so: that is the defect to fix, shown red first. With no app yet, say so and start with the walking skeleton.
3. Take the first feature with `passes` false and build only that one. Do not implement later features ahead, even small ones. One feature is one cycle: build, E2E steps, `passes`, commit, then the next.
4. Run its E2E steps against the running app and show evidence (commands and output, a screenshot for UI). Keep the
   steps as a script in the repo's test setup (see `references/code.md`), so the final pass is one command. Judge UI against the `taste` skill criteria. On failure fix and repeat.
   The walking skeleton commit also records each decision under the spec's `## Decisions` that is costly to reverse as an ADR (`references/architecture.md` of `practices`).
5. Only then set `passes` to true, update `.slice/progress.md` (newest first: done, next, blockers) and commit `slice: <id> <title>`.
6. Take the next feature. When all pass, run the `slice:verifier` agent (spec review, skip style; brief it with the base commit, the parent of the `slice: plan` commit: `git rev-parse "$(git log --format=%H --grep='^slice: plan' -1)^"`) and `/code-review` on the diff from that base, plus `/security-review` when the diff touches authentication, secrets, network
   input or anything users submit (it needs a remote; without one, have a subagent review `git diff <base>` for
   security instead). Fix every finding that holds, then run every feature's E2E steps once more with evidence.
   These reviews and their fixes are part of done: never skip or defer one to save budget or turns. When about a
   quarter of the budget is left, start no new feature and do this step.

Before using a library, framework or CLI API you are not sure about, look up its current docs with the Context7 tools (`resolve-library-id`, then `query-docs`) if they are available; otherwise read the installed package's own docs. Never guess an API.

Keep command output short: filter long test or build output to the failures before reading it.

Never edit anything in `features.json` but `passes`. A feature you cannot finish: write the reason in `progress.md`, leave `passes` false and continue with the next.

Owner-only questions (direction, stack, architecture, UX, anything irreversible): you cannot reach the person. Write each to `.slice/progress.md` under `## Needs decision` as `- f<k>: <question>`, leave that feature `passes` false and continue with the next. Reversible choices: decide, and note them in `progress.md`.

## Scope
Do what was asked; everything else becomes a suggestion in the report. Comments only for a non-obvious why. Debugging: reproduce first, then find the cause, then fix.
