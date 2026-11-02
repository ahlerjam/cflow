---
description: Opts the repo into slice with a marker file, points to Claude Code's run recipe and audits the repo for what an unattended run needs.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
disable-model-invocation: true
---
Set up slice in the current repo. Interactive: it runs in your session because run sessions cannot edit `.claude`. Change nothing that exists without showing it first.

1. Marker. If `.claude/slice.json` is missing, write it. Fields: `excludedCommands` (commands that run outside the sandbox, `Bash(...)` pattern syntax, e.g. `docker compose *`), `allowedDomains` (network the run sessions may reach), `budgetUsd` 30, `maxTurns` 400, `runBudgetUsd` (cap for the whole run, default 5 times `budgetUsd`). Ask at most one question with AskUserQuestion, recommended answer first: the domains the app's dependencies need beyond the package registries already allowed (suggest from the stack and lockfiles). Leave `excludedCommands` empty unless the app needs a tool that cannot run sandboxed, and say that such commands run unsandboxed. If the file exists, show it and change only what the person asks for.
2. Run recipe. Look for a project skill `verify` or `run-<name>` in `.claude/skills/`. Claude Code's own `/verify`
   records `verify`, `/run-skill-generator` records `run-<name>`; slice does not check or write their content.
   - Present: name it and go on.
   - Missing in an existing app: recommend running `/run-skill-generator` now, or `/verify` once on a small change, so
     builders and the before-commit check follow a recorded recipe instead of guessing. Go on either way.
   - Missing in a greenfield repo: skip; there is nothing to record yet. Suggest `/run-skill-generator` after the
     first run.
3. Audit. Propose only what is missing; show it, write after consent.
   - One command each to start, test and lint, e.g. as `make` targets.
   - `CLAUDE.md` (or `AGENTS.md`) under 200 lines that names those commands. If it is missing, suggest `/init`.
   - The run recipe (step 2) and a clean starting state: `git status` clean, the app starts.
   - Large repo (many packages or roughly 50k+ lines): a `CLAUDE.md` per area, a lean root `CLAUDE.md` (pointers and
     gotchas), Read deny rules for build output, an LSP plugin for the main language.
   - Architecture. New app: propose a style in `docs/adr/0001-architecture.md` with the stack; default proposal is
     Vertical Slice Architecture. Existing code: detect the style in use and document it there.
   Greenfield (empty directory or no commits): offer to scaffold the same list (`git init`, make targets,
   `CLAUDE.md`, the ADR) and to create the GitHub repo with `gh repo create` (ask; private by default).

4. Run settings. Write `.claude/slice-run.json` as a copy of `${CLAUDE_PLUGIN_ROOT}/profiles/run.json`, with `sandbox.network.allowedDomains` extended by the marker's `allowedDomains` and `sandbox.excludedCommands` extended by the marker's `excludedCommands`; keep everything else of the profile. The sandbox already allows writes to the working directory, so no `allowWrite` is needed. If `.claude/slice-run.json` exists, show the diff before changing it.
5. Sandbox check. Builders run inside this profile, so prove that the app's tools start there. Pick the
   shortest command from the recipe or README that starts the app (for a terminal tool whose spec needs colors or prompts, also `script -q /dev/null true`, which needs a
   pseudo-terminal; skip the browser, the Playwright plugin runs outside the Bash sandbox) and run it through the profile:
   `claude -p 'Run this Bash command and print its exit code and the last lines of output: <command>' --settings .claude/slice-run.json --permission-mode dontAsk --allowedTools Bash --model haiku --max-budget-usd 0.2`.
   If it fails inside the sandbox, show the error and offer to add that command pattern to the marker's
   `excludedCommands` (it then runs unsandboxed), then repeat step 4 and this check. A run whose builder cannot
   start the app cannot verify anything.

Write nothing beyond the marker, the run settings and what the person accepted in step 3: no lock, hooks or cloud setup. End with: small tickets need nothing from slice (with a recorded `verify` skill Claude Code runs it before each commit); for bigger work run /slice:shape, then /slice:run.
