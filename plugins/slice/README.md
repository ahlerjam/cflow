# slice

slice plans bigger work as a product spec plus an end-to-end feature list, then lets one long Claude Code session build it. A feature counts as done only after its E2E steps ran against the running app and the evidence is in the conversation. You talk to it only in the Claude Code chat. It builds on Claude Code's `/goal`, `/simplify`, `/code-review`, `/verify` and a headless Playwright server that it starts itself.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code | the plugin and the builder sessions | `claude --version` |
| git | worktrees, run branches, commits | `git --version` |
| Node.js | the guard hook of run sessions; `npx` starts the headless Playwright server for features with screens (builder and acceptance use its browser tools) | `node --version`, `npx --version` |

Optional: a Context7 MCP server (the `context7` plugin or your own). Builders use it to look up library docs when it is there. Also optional: a language server for each language in the repo, used by the official `*-lsp` plugins that the `setup` skill offers. Pushing needs a git remote, and the changelog needs the Claude Docs connector; both are used when available.

## Setup

1. Install from the cflow marketplace: `/plugin install slice@cflow`.
2. Ask Claude to "set up slice" (or run `/slice:setup`). It writes the marker `.claude/slice.json`, creates the agent branch, writes the run settings `.claude/slice-run.json` and audits the repo. If there is no recorded run recipe yet, it suggests running Claude Code's `/verify` once (or `/run-skill-generator`) so builders start the app the recorded way.

Setup never commits on the default branch: a new app's scaffold goes on the agent branch (only an empty repo gets one initial commit with a README). If `.claude/` is not writable, for example in `claude -p --permission-mode dontAsk`, setup stops and says what to allow or which two files to create.

In repos without the marker slice stays silent.

## Use

In a repo with the marker, a SessionStart hook tells Claude that slice is active. Describe what to build or change:

- **Planning.** Claude estimates the size. A small change gets quick mode (at most 6 questions); bigger work gets deep mode, which ends only when every area of its coverage list is settled, every feature has executable E2E steps and you confirmed a summary. Keys and access (env var names, accounts, services) are part of the interview; the names go under `## Access` in the spec, never the values. In existing code it runs `Explore` first. In a new app the first feature is a walking skeleton.
- **Start question.** After the summary Claude asks: `Start now`, `Park` or `Plan another task`. Every plan is saved. "Show my plans" lists them with their state; you can start, change or delete one by asking.
- **Run.** Claude never works on the default branch and never touches your checkout. Plans live on one agent branch (`agent` by default) under `.slice/plans/<id>/`; each run has its own run branch in a git worktree under `~/.cache/slice/<repo>/`. Several plans run one after another in a queue. "Stop the run" ends a running run, and "how far is the run?" reports progress.
- **Result.** When the tests are green, the run branch is fast-forwarded into the agent branch and, when a remote exists, pushed. Finished features are merged even if others stay open. You get one line in the chat, and a push notification (when available) after each finished feature and on a halt. The changelog doc (when available) and the merge commit carry the report; there is no PR.
- **Decisions.** A missing key or an owner-only question does not stop the builder. It builds against a fake or a reversible interim solution and records a decision (`D1`, `D2`, ... in `.slice/decisions.md` on the agent branch). "Plan decision D3: use Postgres" turns an entry into a new, independent plan.

Back doors for the same skills: `/slice:setup`, `/slice:shape`, `/slice:run`.

## Know-how

The `practices` skill holds rules with their sources. slice loads each file only when the work needs it:

- **Work items:** outcome titles, vertical slices, INVEST, Given/When/Then turned into executable E2E steps.
- **Cookbooks:** CLI, web UI, HTTP API, library and data job. Each one has coverage questions for the interview, a quality bar and how to test it end to end. Planning writes the quality bar into the spec, and the builder and reviewers check against it.
- **Code:** the repo's formatter and linter, and rules against AI slop (no filler comments, no abstraction without a second caller, no swallowed errors, no tests edited to pass).
- **Architecture:** walking skeleton, vertical slices, ADRs in MADR format.

The `taste` skill covers how screens look: it lists tells of machine-made UI and asks for a design plan before code. When Context7 is available, the builder looks up library APIs there before it uses them.

## The run

- **Readiness gate.** Before the builder starts, the run checks that every feature has steps with a concrete action and an observable result, that the app can be started, that `npx` is on `PATH` for features with screens, that `.claude/slice-run.json` and the marker's `testCommand` exist, and that the turn limit resolves. Missing env names from `## Access` are noted, not blocking. On a gap it lists everything and stops without cost.
- **Build and acceptance.** One builder session builds the features in order against the spec, tests each one on the running app and commits it. It finishes with Claude Code's `/simplify` and `/code-review` (plus `/security-review` when the change handles user input or secrets) and a last full E2E run. When any feature has screens, Claude Code's `/verify` then checks every feature's steps in a fresh session, sandboxed like the builder. A failed acceptance goes back to the builder once; a second failure halts the run.
- **Resume.** A turn stop or a killed builder is resumed in the same session. Two resumes without a newly passing feature halt the run.
- **Gate.** The agent branch is merged into the run branch, `testCommand` runs there, and only a green result is fast-forwarded into the agent branch. Tests of features left open are marked skipped with the reason.
- **Code intelligence.** The `setup` skill offers the official language server plugin for each language in the repo (`typescript-lsp`, `pyright-lsp` and others). With it, the builder sees type errors after every edit and finds code by symbol. Each plugin needs its language server installed; setup shows the command. Cloud sessions start no language servers.

## Where things live

| What | Where |
| --- | --- |
| Marker: `agentBranch`, `testCommand`, `startCommand`, `maxTurns` (400), `allowedDomains`, `excludedCommands`, `changelogDoc`; optional `budgetUsd`, a dollar cap for a whole run, meant for test runs | `.claude/slice.json` |
| Builder settings: the plugin's `profiles/run.json` plus the marker's domains and commands | `.claude/slice-run.json` |
| Plan: spec, feature list, builder log, state | `.slice/plans/<id>/` on the agent branch |
| Open decisions | `.slice/decisions.md` on the agent branch |
| Worktrees, builder and acceptance output (`<id>-worker.json`, `<id>-accept.json`, their `.err` files) | `~/.cache/slice/<repo>/` (or under `XDG_CACHE_HOME`) |

## Limits

- The builder runs sandboxed with `failIfUnavailable`. Network is limited to the package registries plus `allowedDomains`, and commands in `excludedCommands` run unsandboxed.
- Features with screens use a headless Playwright server from `mcp/playwright.json`, passed with `--mcp-config` to the builder and the acceptance only. The run settings switch off `playwright@claude-plugins-official` for those sessions, so no second, visible browser opens.
- Plans run one after another. Parallel runs are not part of this version.
- On a cloud VM (`CLAUDE_CODE_REMOTE=true`) the run uses the profile without sandbox. Cloud runs aren't tested end to end for this version. Cloud sessions don't install plugins from the repo's settings, so slice has to be loaded another way there, and background shell work in a cloud VM is limited in time, which can cut a long builder short.
- In a run session (`SLICE_RUN=1`; other sessions skip it before Node starts) a hook (`scripts/guard-features.mjs`, Node.js) rejects edits to the plan's `features.json` other than `passes`, and shell commands that name the file in anything but a read. After every shell command it compares the file with the `slice: plan <id>` commit and tells the builder to restore it when more than `passes` changed.
