# slice

slice adds a small mod to your Claude Code session. The mod runs the proof itself, a fresh verifier checks the claim, and you accept the result, so the agent's own report of success is never the end of a job.

It covers a small ticket, a supervised feature and an unattended run of a whole stage, on your Mac, in a Claude Code cloud session, or both.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code 2.1.312 or later | the plugin and its mod | `claude --version` |
| git | state, worktrees, diffs and the proof cache | `git --version` |
| make | every proof runs as a make target | `make --version` |

Node.js and Playwright (`npm install -g playwright`) are only needed in repos with a UI, for `scripts/ui-check.mjs`. A claude.ai login is needed for the acceptance page as an Artifact, for push notifications and for cloud runs; without it the page is a local HTML file.

## Install

```
/plugin install slice@cflow
```

## Use

Run `/slice:setup` once per repo. It measures the test suite, writes the make targets (`check`, `verify`, `test-affected`), a pre-commit hook, the lock script, a short verification section in `AGENTS.md`, and finally the marker `.claude/slice.json`. Without that marker the mod does nothing, in this repo too. Setup leaves the bundled `/verify` alone and suggests `/run-skill-generator` when the app needs more than a standard launch, so `/run` and `/verify` know how to start it.

After a restart, the `slice` skill sizes each job in one line (`ticket · low · proof: make verify-export`). The agent then works as usual and ends with the `slice` tool:

- `prove` runs an allowed make target under a machine-wide lock. It first rejects TODOs, stubs, placeholder text, tests without an assertion and new Markdown files in the diff since the main checkout's `HEAD`. A pass is cached per file tree, so an unchanged tree is not proved again.
- `red` runs the proof before the code exists. It must fail on an assertion, not on a missing file, and then freezes the test files. `amend` opens a frozen proof once, with a reason that shows on the acceptance page.
- `done` closes the job. It refuses without a passed proof on the current tree, and below the level the diff calls for (core paths at least medium, paths from a `/slice-miss` note of the last 30 days high). A bug fix needs its proof to have failed first. Medium risk needs the bundled `/code-review` on that tree, which the agent runs itself and the mod records, or a skip you choose in the mod's dialog. High risk needs a pass that the verifier recorded on the same tree.
- `note` logs a decision, or freezes a proof (`cmd` and `files`). Later edits to frozen files in the main checkout need your approval, and a frozen proof cannot be frozen again.

For a feature, the agent runs `/slice:feature` with an id, the claim and a quality brief (or you type "ultracode"). The mod creates a git worktree. `slice:builder` writes the proof tests, which must fail first, and then the code. The tool proves it, the mod commits the candidate, and a fresh `slice:verifier` checks it. Failures go back to the builder with its last report, three rounds at most.

### An unattended run

1. `/slice:shape` turns an idea into a queue of 6 to 15 slices with you, in about 20 minutes. It asks at most 6 questions and brings a parity table against a real product, mockups for screens, a dependency allowlist and a budget. It ends when you approve the queue and its permission scope in the mod's own dialog.
2. `/slice:run` asks whether your Mac stays online and starts the first slice as a background session (`claude --bg`). Each session works one slice through `/slice:feature`, then the mod merges it into the run branch `slice/<stage>`, runs `make check` and every proof, reverts a merge that turns an old proof red, and starts the next session. Run sessions get a fixed permission profile: they edit only their worktree, run only make targets, and cannot commit, push, open PRs or receive messages from other sessions.
3. The run pauses above 90 % of the 5-hour limit and wakes itself after the reset. It halts at a spend or credit limit, at 70 % of the weekly limit, at three times the stage budget, under 20 GB free disk and after its wall-clock time. Each halt and the end send a push to your phone through Claude Code. After two slices a pilot page is written, and after every third slice a progress page.
4. `/slice:accept` proves everything once more on the run branch and builds the acceptance page: waiting for you, changed, found. It shows one random low-risk slice for a full look. A reject queues a fix slice, a miss and a calibration example for the verifier. You merge the run branch yourself.

`/slice-status` shows what is merged, running, in the cloud and waiting for you; the same summary appears as a status line when you open Claude Code. `/slice-pause`, `/slice-resume` and `/slice-stop` control the run. `/slice-miss "<line>"` records something the harness missed and offers one rule line for the verification section, which you confirm. The mod commands use a dash because a mod cannot register a colon.

### Local, cloud, or both

Plugins do not load in Claude Code cloud sessions, so setup can copy slice into the repo (`.slice/plugin`) and add a small `slice-cloud` skill. A cloud session then only dispatches, and the work runs in a nested `claude -p --plugin-dir .slice/plugin` with the mod active.

Local runs everything on your Mac. Cloud starts the approved stage from a cloud session, from your phone too, and your Mac can be off; progress comes back as a push and as `refs/slice/<stage>-status`, which `/slice-status` reads. Mixed sends slices without UI or heavy local load from a local run to the cloud and verifies them locally when their branch comes back. Cloud sessions count against the same usage limits as local ones: the cloud saves your Mac's CPU, memory and battery, but it uses the same tokens. They need a GitHub remote that cloud sessions can push to.

Models for run sessions are plugin options (`runModel`, `runEffort`, `fallbackModel`; set them with `/config`). With Sonnet as the main model, `/advisor opus` lets Sonnet and the `slice:builder` consult Opus at decision points; Anthropic reports higher scores at lower cost per task than Sonnet alone ([The advisor strategy](https://claude.com/blog/the-advisor-strategy)). The verifier stays a separate fresh context, because the advisor reads the same conversation.

## What it protects against, and what it does not

The guard is a safety net. It blocks `.skip`/`.only`, `|| true` in test and CI scripts, direct test runners in runs and subagents, writes to its own state, builders outside their worktree and a verifier that edits files or changes git state. Edits to Makefiles, hooks, CI, dependencies, `.env` files and ADRs ask you first. It does not read Bash commands for file writes, so the real limits are the sandbox, the proof the mod runs itself, CI and your acceptance. Commands listed in `excludedCommands` (patterns such as `docker compose *` or `latexmk *`) run outside the sandbox.

`claude -p` counts as a run: the stricter rules apply. Mod errors block calls instead of passing them. Push notifications need a working session: a session that hangs sends none. The repo code that `/slice:setup` writes (make targets, hook, CI) keeps working if the mod is off.

## Setup

State lives in `.git/slice/` (state, log, proof cache, pages, run settings) and is never committed. Worktrees live under `~/.cache/slice/`. The keys of `.claude/slice.json` are optional: `corePaths` (path prefixes of core logic), `germanUiPaths`, `throwaway`, `excludedCommands`, `allowedDomains` and `cloud`. The path of the lock is `/tmp/slice-lock-<uid>.l`; set `SLICE_LOCK_WAIT` (seconds, default 90) for `scripts/slice-lock.sh`. That script's own cache only spares the hook a rerun; the mod never takes it as proof.
