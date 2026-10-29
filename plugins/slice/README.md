# slice

slice adds a small mod to your Claude Code session. The mod runs the proof itself, a fresh verifier checks the claim, and you accept the result, so the agent's own report of success is never the end of a job.

This first release covers tickets and supervised features. The unattended multi-slice run, the acceptance page and the cloud lane are not part of it yet.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code 2.1.311 or later | the plugin and its mod | `claude --version` |
| git | state, worktrees, diffs and the proof cache | `git --version` |

Node.js and Playwright (`npm install -g playwright`) are only needed in repos with a UI, for `scripts/ui-check.mjs`. A claude.ai login is only needed once the acceptance page ships.

## Install

```
/plugin install slice@cflow
```

## Use

Run `/slice:setup` once per repo. It measures the test suite, writes the make targets (`check`, `verify`, `test-affected`), a pre-commit hook, the lock script, a short verification section in `AGENTS.md`, a project `verify` skill, and finally the marker `.claude/slice.json`. Without that marker the mod does nothing, in this repo too.

After a restart, the `slice` skill sizes each job in one line (`ticket · low · proof: make verify-export`). The agent then works as usual and ends with the `slice` tool:

- `prove` runs an allowed make target under a machine-wide lock. It first rejects TODOs, stubs, placeholder text, tests without an assertion and new Markdown files. The result is cached per file tree; the same tree is never proved twice.
- `done` closes the job. It refuses without a passed proof on the current tree. Medium risk needs `/code-review high` or a spoken skip; high risk needs a pass that the verifier recorded on the same tree.
- `note` logs a decision, or freezes a proof (`cmd` and `files`). Later edits to frozen files need your approval.

For a feature, run `/slice:feature` (or type "ultracode"). The workflow creates a git worktree, lets `slice:builder` write the proof tests and the code, has the tool prove it, and hands the result to a fresh `slice:verifier`. Failures go back to the builder, three rounds at most.

Other commands: `/slice-status` shows mode, version and the last log lines; `/slice-miss "<line>"` records something the harness missed. The mod commands use a dash because a mod cannot register a colon.

## What it protects against, and what it does not

The guard is a safety net. It blocks `.skip`/`.only`, `|| true` in test and CI scripts, direct test runners in runs and subagents, writes to its own state, builders outside their worktree and a verifier that changes anything. It does not read Bash commands for file writes, so the real limits are the sandbox, the proof the mod runs itself, CI and your acceptance. Commands listed in `excludedCommands` (docker, latexmk and similar) run outside the sandbox.

`claude -p` counts as a run: the stricter rules apply. Mod errors block calls instead of passing them. The repo code that `/slice:setup` writes (make targets, hook, CI, the `verify` skill) keeps working if the mod is off.

## Setup

State lives in `.git/slice/` (state, log, proof cache) and is never committed. The optional `.claude/slice.json` takes `coreCmds`, `germanUiPaths`, `throwaway`, `excludedCommands` and `allowedDomains`. The path of the lock is `/tmp/slice-lock-<uid>.l`; set `SLICE_LOCK_WAIT` (seconds, default 90) for `scripts/slice-lock.sh`.
