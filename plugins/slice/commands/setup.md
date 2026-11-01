---
description: Opts the repo into slice with a marker file, checks that a verify recipe exists and offers NORTHSTAR.md and a stack ADR for new repos.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
disable-model-invocation: true
---
Set up slice in the current repo. Interactive: it runs in your session because run sessions cannot edit `.claude`. Change nothing that exists without showing it first.

1. Marker. If `.claude/slice.json` is missing, write it. Fields: `excludedCommands` (commands that run outside the sandbox, `Bash(...)` pattern syntax, e.g. `docker compose *`), `allowedDomains` (network the run sessions may reach), `budgetUsd` 30, `maxTurns` 400, `runBudgetUsd` (cap for the whole run, default 5 times `budgetUsd`), `end` (default end mode of /slice:run: `pr`, `feature-prs`, `merge` or `branch`). Ask at most two questions with AskUserQuestion, recommended answer first: the domains the app's dependencies need beyond the package registries already allowed (suggest from the stack and lockfiles), and the default end mode (recommend `pr`). Leave `excludedCommands` empty unless the app needs a tool that cannot run sandboxed, and say that such commands run unsandboxed. If the file exists, show it and change only what the person asks for.
2. Verify recipe. Look for `.claude/skills/verify/SKILL.md`.
   - Missing: tell the person to run `/run-skill-generator` (or `/verify` once on a small change) so one gets recorded, then come back to `/slice:setup`. Stop here.
   - Present: check that it states when to run, the steps to start and drive the app, what proves success (measurable, with evidence: commands and output, a screenshot for UI) and what to do on failure. Offer to add whatever is missing.
3. New repo without docs (no README, `NORTHSTAR.md` or `docs/adr/`): offer `NORTHSTAR.md` (at most 30 lines: goal, non-goals, how success is measured, first stage) and one stack ADR `docs/adr/0001-stack.md`. Write them only if the person wants them.

Write nothing else: no make targets, lock, hooks or cloud setup. The mod loads the marker at session start, so tell the person to restart the session. End with: small tickets work right away; for bigger work run /slice:shape, then /slice:run.
