---
description: Opts the repo into slice with a marker file, checks that a verify recipe exists and offers NORTHSTAR.md and a stack ADR for new repos.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
disable-model-invocation: true
---
Set up slice in the current repo. Interactive: it runs in your session because run sessions cannot edit `.claude`. Change nothing that exists without showing it first.

1. Marker. If `.claude/slice.json` is missing, write it. Fields: `excludedCommands` (commands that run outside the sandbox, `Bash(...)` pattern syntax, e.g. `docker compose *`), `allowedDomains` (network the run sessions may reach), `budgetUsd` 30, `maxTurns` 400, `runBudgetUsd` (cap for the whole run, default 5 times `budgetUsd`). Ask at most one question with AskUserQuestion, recommended answer first: the domains the app's dependencies need beyond the package registries already allowed (suggest from the stack and lockfiles). Leave `excludedCommands` empty unless the app needs a tool that cannot run sandboxed, and say that such commands run unsandboxed. If the file exists, show it and change only what the person asks for.
2. Verify recipe. Look for `.claude/skills/verify/SKILL.md`.
   - Missing: tell the person to run `/run-skill-generator` (or `/verify` once on a small change) so one gets recorded, then come back to `/slice:setup`. Stop here.
   - Present: check that it states when to run, the steps to start and drive the app, what proves success (measurable, with evidence: commands and output, a screenshot for UI) and what to do on failure. Offer to add whatever is missing.
3. New repo without docs (no README, `NORTHSTAR.md` or `docs/adr/`): offer `NORTHSTAR.md` (at most 30 lines: goal, non-goals, how success is measured, first stage) and one stack ADR `docs/adr/0001-stack.md`. Write them only if the person wants them.

4. Run settings. Write `.claude/slice-run.json` as a copy of `${CLAUDE_PLUGIN_ROOT}/profiles/run.json`, with `sandbox.network.allowedDomains` extended by the marker's `allowedDomains` and `sandbox.excludedCommands` extended by the marker's `excludedCommands`; keep everything else of the profile. The sandbox already allows writes to the working directory, so no `allowWrite` is needed. If `.claude/slice-run.json` exists, show the diff before changing it.
5. Sandbox check. Builders run inside this profile, so prove that the verify recipe's tools start there. Pick the
   shortest command from the recipe that starts the app or its driver (for a browser recipe: launch the browser
   headless, open `about:blank`, close it) and run it through the profile:
   `claude -p 'Run this Bash command and print its exit code and the last lines of output: <command>' --settings .claude/slice-run.json --permission-mode dontAsk --allowedTools Bash --model haiku --max-budget-usd 0.2`.
   If it fails inside the sandbox, show the error and offer to add that command pattern to the marker's
   `excludedCommands` (it then runs unsandboxed), then repeat step 4 and this check. A run whose builder cannot
   start the app cannot verify anything.

Write nothing else: no make targets, lock, hooks or cloud setup. End with: small tickets work right away; for bigger work run /slice:shape, then /slice:run.
