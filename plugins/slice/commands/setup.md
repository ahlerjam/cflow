---
description: "Opts a repo into slice: measures the test suite, writes make targets, the lock, a pre-commit hook, the verification section and the verify skill, then sets the marker."
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion
---
Set up slice in the current repo. This runs in an interactive session because the run profile cannot edit `.git`, `.husky` or `.claude`. Without a person to ask, use the defaults named below and say so. Change nothing that exists without showing it first; merge instead of skipping.

1. Look. Stack, package manager, test commands, CI files, existing `Makefile`, `AGENTS.md`, `CLAUDE.md`, `.claude/`. Count committers with `git shortlog -sn | head`; with more than one other committer commit only what the repo already uses and put the verification section in a git-excluded `CLAUDE.local.md`.
2. Measure the suite and split it by time: while editing seconds (`make test-affected FILES=…`), pre-commit at most 60 s (`make check`), PR minutes (`make verify`, CI). Ask one AskUserQuestion about tests to delete or merge, with your recommendation first; default: keep all.
3. Write what is missing:
   - `Makefile` targets `check`, `verify`, `test-affected` with worker limits (cores minus 2, at most 4), plus an end-to-end `verify-*` target for the repo's main behaviour with real data.
   - `scripts/slice-lock.sh` copied from `${CLAUDE_PLUGIN_ROOT}/scripts/slice-lock.sh`; the Makefile and the hook run their commands through it.
   - A pre-commit hook that runs `make check` through the lock.
   - A CI job for `make check` and the proofs a hosted runner can run, only in private repos with a GitHub remote.
   - `.claude/skills/verify/SKILL.md` from `${CLAUDE_PLUGIN_ROOT}/templates/verify-skill.md`; merge if the folder exists. Only if `.claude/` already exists in repos others read.
   - In `AGENTS.md` a verification section of at most 15 lines: the three make targets, the tiers, "ask the slice tool to prove; never trust your own run", and the scope contract. If `CLAUDE.md` is missing create it with one line `@AGENTS.md`; if it exists and lacks that line, add it.
4. UI repos: suggest `/run-skill-generator` and make ports and paths in the recipe come from `.slice-env`. Suggest `excludedCommands` (docker, kubectl, latexmk…) and `allowedDomains` for the stack; they run outside the sandbox, say so.
5. Worktree root: ask once whether to add `~/.cache/slice/` to `permissions.additionalDirectories` in the user settings. Default: no.
6. Last, write `.claude/slice.json` (at most 15 lines: `coreCmds`, `germanUiPaths`, `throwaway`, `excludedCommands`, `allowedDomains`) and add it to `.git/info/exclude`. The file is the opt-in marker; restart the session so the mod loads it.

Finish with a list of the files written or changed. Never write plans, specs, progress files or a Markdown file per feature.
