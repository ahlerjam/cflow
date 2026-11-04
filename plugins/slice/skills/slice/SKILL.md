---
name: slice
description: Builder rules for unattended slice run sessions. Builds the features in .slice/plans/$SLICE_PLAN/features.json in one session against the spec, checks them on the running app and finishes with /simplify and /code-review. Use when working in a run session (SLICE_RUN=1) in a repo set up with slice (.claude/slice.json).
when_to_use: SLICE_RUN=1, SLICE_PLAN, slice builder session.
user-invocable: false
---
Active only in a run session (`SLICE_RUN=1`). Otherwise ignore this skill. Never wait for the person.
`<plan>` below is `.slice/plans/$SLICE_PLAN/` (read the env var with Bash).

## Start
Read `<plan>/spec.md` (with its `## Quality bar`, `## Decisions` and `## Access`), `<plan>/features.json`,
`<plan>/progress.md` if present and `git log --oneline -20`. Invoke the `practices` skill and load its `references/code.md`, the cookbook for
the type the spec names, and in a new app its `references/architecture.md`. After a resume or a compaction, do this
again first.

## Build
Build the features in their order, the way you would on your own. With no app yet, start with the walking skeleton.
Follow `## Decisions`. Names under `## Access` are env vars: use the value when it is set, otherwise build against
a fake (stub, fixture, local fake server) and record a decision (see Rules). Write an ADR only for a decision that is costly to reverse and had real
alternatives (an app of a few files needs none; its README names the stack).

Write each feature's steps as tests in the repo's one E2E test file (for screens, the format in the web cookbook)
and run them against the running app. When a
feature's tests pass, set its `passes` to true and commit `slice: <id> <title>`; these commits let a resumed session
continue where it stopped. Right after the commit, send a push notification (PushNotification tool, if available)
with the feature and its title; skip it silently when the tool is missing.

## How to run the app
Use the project's `verify` skill (`.claude/skills/verify/SKILL.md`) or a `run-<name>` skill if the repo has one.
Otherwise start the app from the README, `Makefile` or package scripts. CLI and servers: Bash. Screens: the E2E file
holds Playwright code that you run with the headless Playwright server's run-code tool (`mcp__playwright__*`, loaded
by the run for features with screens), since Chromium cannot start inside the
Bash sandbox. Start servers in the background on a fixed port and stop them when done. You cannot write inside
`.claude/`; if the recorded recipe is wrong, write the fix to `<plan>/progress.md` under `## Recipe changes`.

## Finish
When all features pass, work on the diff from the base commit, the parent of the `slice: plan $SLICE_PLAN` commit
(`git rev-parse "$(git log --format=%H --grep="^slice: plan $SLICE_PLAN\$" -1)^"`):
1. Claude Code's `/simplify`, then rerun the E2E tests.
2. `/code-review`, plus `/security-review` when the diff touches authentication, secrets, network input or anything
   users submit (it needs a remote; without one, have a subagent review `git diff <base>` for security instead).
   Fix every finding that holds.
3. Run the whole E2E file once more and show the output. For screens, look at each view with the Playwright browser
   tools at 360 and 1280 px, take a screenshot each and judge it against the `taste` skill and the `## Quality bar`;
   fix what fails and rerun the tests.

These steps are part of done: never skip one to save budget or turns. When about three quarters of your turn limit are used,
start no new feature and finish.

## Rules
- Never edit anything in `features.json` but `passes`. A feature you cannot finish: write the reason in
  `progress.md`, leave `passes` false and go on. Mark the E2E tests of features left open as skipped, with the
  reason, so the full E2E run stays green.
- Decisions: a missing key, or an owner-only question (direction, stack, architecture, UX, anything irreversible).
  Do not stop and do not wait. Build a reversible interim solution (a fake for a missing key), then write the entry to
  `<plan>/progress.md` under `## Needs decision`, in this format:
  ```
  - f<k>: <one-line question>
    Interim: <what the build does now>
    Options: <A (recommended)> | <B> | …
  ```
  If the feature cannot work without the answer, leave `passes` false and go on. Reversible choices: decide and note
  them in `progress.md`.
- Before using a library, framework or CLI API you are not sure about, look up its current docs with the Context7
  tools (`resolve-library-id`, then `query-docs`) if they are available; otherwise read the installed package's docs.
- With a language server running, fix its diagnostics after each edit; use the `LSP` tool to find definitions and
  references instead of text search.
- Keep command output short: filter long test or build output to the failures.
- Do what was asked; everything else becomes a suggestion in `progress.md`. Comments only for a non-obvious why.
