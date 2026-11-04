---
name: setup
description: Opts the repo into slice with a marker file, creates the agent branch, writes the run settings and audits the repo for what an unattended run needs. Use only when the person asks to set up slice in the current repo.
when_to_use: /slice:setup, "set up slice", "richte slice ein", "slice einrichten", "slice in diesem Repo einrichten".
---
Set up slice in the current repo, only because the person asked. Interactive: it runs in your session because run sessions cannot edit `.claude`. Change nothing that exists without showing it first.

1. Marker. If `.claude/slice.json` is missing, write it with the Write tool, with the detected defaults first, then
   ask the questions below and change the file to the answers. This write is also the access test: a `-p` session in
   `dontAsk` mode may be denied writes to `.claude/`. If the Write tool is denied, stop setup here. Tell the person in
   one or two lines what to allow (`Write(.claude/**)`) or which two files to create, each with path and content:
   `.claude/slice.json` (the marker with the detected values) and `.claude/slice-run.json` (a copy of
   `${CLAUDE_PLUGIN_ROOT}/profiles/run.json`). Do none of the later steps and plan
   nothing. Fields: `agentBranch` (`agent`), `testCommand` (the repo's test command; detect it, confirm it), `startCommand` (optional, how to start the app), `maxTurns` 400, optional `builderModel` (default `opus`) and `builderAdvisor` (a model alias such as `opus`, or `off`; unset uses the person's settings), `allowedDomains` (network the run sessions may reach), `excludedCommands` (commands that run outside the sandbox, `Bash(...)` pattern syntax, e.g. `docker compose *`), `changelogDoc` (optional, step 7), `cloudPluginRef` (optional, only for testing before a release: the cflow branch or tag a cloud start clones the plugin from; leave it out otherwise). Write no dollar cap; an optional `budgetUsd` (cap for a whole run) is only for test runs. Ask at most two questions with AskUserQuestion, recommended answer first: the test command if it is unclear, and the domains the app's dependencies need beyond the package registries already allowed (suggest from the stack and lockfiles). Leave `excludedCommands` empty unless the app needs a tool that cannot run sandboxed, and say that such commands run unsandboxed. If the file exists, show it and change only what the person asks for.
2. Run recipe. Look for a project skill `verify` or `run-<name>` in `.claude/skills/`. Claude Code's own `/verify`
   records `verify`, `/run-skill-generator` records `run-<name>`; slice does not check or write their content. A
   project skill named `verify` in place at session start makes Claude Code tell Claude to run it before
   each commit, except for changes to docs or tests; the docs state no restriction to interactive sessions. slice
   switches that off in its run sessions (`skillOverrides` in the run settings) and has builders read the recipe
   instead. A `run-<name>` skill only tells sessions how to start the app.
   - Present: name it and go on.
   - Missing in an existing app: recommend running `/verify` once on a small change (it records `verify`), or `/run-skill-generator`, so
     builders follow a recorded recipe instead of guessing (your own sessions then also run it before commits). Go on either way.
   - Missing in a greenfield repo: skip; there is nothing to record yet. Suggest `/verify` after the
     first run.
3. Audit. Propose only what is missing; show it, write after consent.
   - One command each to start, test and lint, e.g. as `make` targets.
   - `CLAUDE.md` (or `AGENTS.md`) under 200 lines that names those commands. If it is missing, suggest `/init`.
   - The run recipe (step 2) and a clean starting state: `git status` clean, the app starts.
   - Screens: if the app has or will have a browser UI, check that `npx` is on `PATH` (`command -v npx`); missing:
     tell the person to install Node.js. Runs bring their own headless Playwright server through `npx`, so no
     Playwright plugin is needed; runs without screens do not need `npx`.
   - Secrets: names under `## Access` come from the environment or a gitignored `.env` (or the files listed in
     `.worktreeinclude`), which a run copies into its worktree. For cloud runs they must be environment variables of
     the cloud environment instead. For long cloud runs, tell the person to also set `BASH_DEFAULT_TIMEOUT_MS` and
     `BASH_MAX_TIMEOUT_MS` there (milliseconds, for example 3600000 and 7200000); a command that outlives the
     default is cut after 30 more minutes otherwise.
   - `.slice/` is committed on the agent branch; `.claude/slice-run.json` is local and may be gitignored.
   - Code intelligence: for each language the repo is written in that has an official language server plugin
     (`typescript-lsp`, `pyright-lsp`, `gopls-lsp`, `rust-analyzer-lsp`, `jdtls-lsp`, `kotlin-lsp`, `csharp-lsp`,
     `clangd-lsp`, `php-lsp`, `ruby-lsp`, `swift-lsp`, `lua-lsp` in `claude-plugins-official`), check whether it is
     enabled (`claude plugin list`) and whether its binary is on `PATH` (`which <binary>`). Missing: show the binary's
     install command from the plugin's README and, after consent, run
     `claude plugin install <plugin>@claude-plugins-official`. Builders then see type errors after each edit and
     navigate by symbol. Recommend it strongly in a large repo; in a greenfield repo, offer it once the stack is set.
   - Large repo (many packages or roughly 50k+ lines): a `CLAUDE.md` per area, a lean root `CLAUDE.md` (pointers and
     gotchas), Read deny rules for build output.
   - Architecture. New app beyond a few files: propose a style in `docs/adr/0001-architecture.md` with the stack;
     default proposal is Vertical Slice Architecture. A small app names the stack in its README. Existing code: detect the style in use and document it there.
   Greenfield (empty directory or no commits): offer to scaffold the same list (`git init`, make targets,
   `CLAUDE.md`, the ADR). Never commit on the default branch: write the scaffold in the agent worktree (step 6) and
   commit it there as `slice: setup`. Do step 6 first for this. The one exception: a repo with no commit at all gets
   one initial commit on the default branch that contains nothing but a README, because a branch needs a commit to
   start from. Tell the person you made it.

4. Run settings. Write `.claude/slice-run.json` as a copy of `${CLAUDE_PLUGIN_ROOT}/profiles/run.json`, with `sandbox.network.allowedDomains` extended by the marker's `allowedDomains` and `sandbox.excludedCommands` extended by the marker's `excludedCommands`; keep everything else of the profile. The sandbox already allows writes to the working directory, so no `allowWrite` is needed. If `.claude/slice-run.json` exists, show the diff before changing it.
5. Sandbox check. Builders run inside this profile, so prove that the app's tools start there. Pick the
   shortest command from the recipe or README that starts the app (for a terminal tool whose spec needs colors or prompts, also `script -q /dev/null true` on macOS or `script -q -c true /dev/null` on Linux, which needs a
   pseudo-terminal; skip the browser, the Playwright server runs outside the Bash sandbox) and run it through the profile:
   `claude -p 'Run this Bash command and print its exit code and the last lines of output: <command>' --settings .claude/slice-run.json --permission-mode dontAsk --allowedTools Bash --model haiku --max-budget-usd 0.2`.
   If it fails inside the sandbox, show the error and offer to add that command pattern to the marker's
   `excludedCommands` (it then runs unsandboxed), then repeat step 4 and this check. A run whose builder cannot
   start the app cannot verify anything.
6. Agent branch. Create the branch `agentBranch` from the repo's default branch (`git symbolic-ref
   --short refs/remotes/origin/HEAD`, else `main` or `master`) without switching the person's checkout
   (`git branch <agentBranch> <default>`). It exists already: leave it. A repo without any commit gets the README-only
   initial commit first (step 3). The agent worktree is `${XDG_CACHE_HOME:-$HOME/.cache}/slice/<repo dir name>/agent`
   (`git worktree add <path> <agentBranch>`); the scaffold of step 3 is written and committed there.
7. Changelog doc. If the Claude Docs connector is available in this session, offer to create one doc as the repo's
   changelog and store its link in the marker as `changelogDoc`. Without the connector, skip and say runs report in
   the merge commit instead.

Write nothing beyond the marker, the agent branch, the run settings and what the person accepted in step 3 (including
language server plugins): no lock, hooks or cloud setup. End with: just describe what to build, slice plans it and
asks to start; "show my plans" lists the plans.
