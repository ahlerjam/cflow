# slice

slice plans bigger work as a product spec plus an end-to-end feature list, then lets one long Claude Code session build it. A feature counts as done only after its E2E steps ran against the running app and the evidence is in the conversation. It builds on Claude Code's `/goal`, `/simplify`, `/code-review`, `/verify` and the official Playwright plugin.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code | the plugin and the builder sessions | `claude --version` |
| git | run branch, diffs, commits | `git --version` |
| Node.js | the Playwright plugin, which slice installs as a dependency (`npx @playwright/mcp`), and the guard hook of run sessions | `node --version` |
| gh | issue planning in `/slice:shape`, `/slice:run #<n>` and PR delivery; optional for files only | `gh auth status` |

Optional: a Context7 MCP server (the `context7` plugin or your own). Builders use it to look up library docs when it is there. Also optional: a language server for each language in the repo, used by the official `*-lsp` plugins that `/slice:setup` offers.


## Setup

1. Install from the cflow marketplace: `/plugin install slice@cflow`.
2. Run `/slice:setup` in the repo. It writes the marker `.claude/slice.json`, writes the run settings `.claude/slice-run.json` and audits the repo. If there is no recorded run recipe yet, it suggests running Claude Code's `/run-skill-generator` (or `/verify` once) so builders start the app the recorded way.

## Use

- **Small ticket.** slice stays out of it. With a recorded `verify` skill in the repo, Claude Code runs it before each commit on its own.
- **Bigger work.** `/slice:shape` plans it. Quick mode asks at most 6 questions (a ticket); deep mode has no limit and ends only when every area of its coverage list is settled, every feature has executable E2E steps and you confirmed a summary (an epic or milestone). In existing code it runs `Explore` first and puts the summary in the epic. In a new app the first feature is a walking skeleton: the app starts with one documented command and the core path runs end to end.
- **Where the plan goes.** With a GitHub remote and a working `gh`, shape offers to create issues. Without, it writes `.slice/spec.md` and `.slice/features.json`. Review them, then run `/slice:run`.

`/background` detaches the session while the run goes on.

## Know-how

The `practices` skill holds rules with their sources. slice loads each file only when the work needs it:

- **Issues:** outcome titles, vertical slices, INVEST, Given/When/Then turned into executable E2E steps, epics with sub-issues and milestones.
- **Cookbooks:** CLI, web UI, HTTP API, library and data job. Each one has coverage questions for the interview, a quality bar and how to test it end to end. `/slice:shape` writes the quality bar into the spec, and the builder and reviewers check against it.
- **Code:** the repo's formatter and linter, and rules against AI slop (no filler comments, no abstraction without a second caller, no swallowed errors, no tests edited to pass).
- **Architecture:** walking skeleton, vertical slices, ADRs in MADR format.

The `taste` skill covers how screens look: it lists tells of machine-made UI and asks for a design plan before code. When Context7 is available, the builder looks up library APIs there before it uses them.

## Issue formats

All calls use the REST API through `gh api`.

- **Epic.** Label `slice`. Body: `## Spec` (product-level spec) and optionally `## Context` (summary of the existing code). Its sub-issues are the features, in build order.
- **Feature or ticket.** Label `slice`, plus `ui` for features with screens. Body: `## E2E steps` as a `- ` list of what a user does and sees, with concrete inputs and expected output; optionally `## Notes`.
- **Milestone.** Holds epics and/or tickets.

## `/slice:run`

`/slice:run [#<n> | milestone:<n>] [epic-pr | issue-prs] [accept]`

- **Source.** `#<n>` is an epic or a ticket, `milestone:<n>` all its open issues. `scripts/issues-to-files.sh` turns them into `.slice/spec.md` and `.slice/features.json`, copying the steps verbatim, and the run commits both as `slice: plan from #<n>`. They stay in the PR as the record of what was built. Without an argument the run uses the existing `.slice` files.
- **Readiness gate.** Before the builder starts, the run checks that every feature has steps with a concrete action and an observable result, that the app can be started (recorded recipe, README or a walking skeleton), that the Playwright plugin is enabled for features with screens, that `.claude/slice-run.json` exists, that budget, turn limit and run budget resolve, and that the delivery mode is known (for issues, `gh auth status` works). On a gap it lists everything, points to `/slice:shape` or `/slice:setup`, and stops without cost.
- **Build and acceptance.** One builder session builds the features in order against the spec, tests each one on the running app and commits it. It finishes with Claude Code's `/simplify` and `/code-review` (plus `/security-review` when the change handles user input or secrets) and a last full E2E run. When any feature has screens (or with `/slice:run accept`), Claude Code's `/verify` then checks every feature's steps in a fresh session, sandboxed like the builder. A failed acceptance goes back to the builder once; a second failure halts the run with the list.
- **Code intelligence.** `/slice:setup` offers the official language server plugin for each language in the repo (`typescript-lsp`, `pyright-lsp` and others). With it, the builder sees type errors after every edit and finds code by symbol. Each plugin needs its language server installed; setup shows the command. Cloud sessions start no language servers.
- **Needs decision.** The builder works without GitHub. It writes owner-only questions (direction, stack, architecture, UX, anything irreversible) to `.slice/progress.md` under `## Needs decision`, leaves that feature open and moves on. After the run each question becomes a comment on the feature's issue with the label `needs-decision`.
- **Delivery.** The builder never pushes; the run does.
  - `epic-pr` (default for issues): one draft PR with `Closes #<n>` for every passed feature (and the epic if all passed), the open features with their reason, and the questions.
  - `issue-prs`: one stacked draft PR per feature commit, on branches `<run branch>-f<k>`, each based on the previous one, with `Closes #<issue>`. Stacked PRs close their issue only after retargeting to the default branch.
  - Files only: the branch, then you open the PR.
  - Each passed feature issue gets a comment with the run branch and commit.
- **Default branch.** GitHub closes issues with `Closes` only on a merge into the default branch. If the base is another branch, the PR body and the report say so.

## Where things live

| What | Where |
| --- | --- |
| Marker: `budgetUsd` (30), `maxTurns` (400), `runBudgetUsd` (5 times `budgetUsd`), `allowedDomains`, `excludedCommands` | `.claude/slice.json` |
| Builder settings: the plugin's `profiles/run.json` plus the marker's domains and commands | `.claude/slice-run.json` |
| Spec, feature list, builder log (from the issues, for an issue source) | `.slice/spec.md`, `.slice/features.json`, `.slice/progress.md` |
| Builder and acceptance output (`worker.json`, `accept.json`, their `.err` files) | `~/.cache/slice/<repo>/` (or under `XDG_CACHE_HOME`) |

## Limits

- The builder runs sandboxed with `failIfUnavailable`. Network is limited to the package registries plus `allowedDomains`, and commands in `excludedCommands` run unsandboxed.
- On a cloud VM (`CLAUDE_CODE_REMOTE=true`) the run uses the profile without sandbox. There the builder could reach GitHub; only `git push`, `gh pr` and `gh release` are denied. Cloud runs aren't tested end to end for this version.
- In a run session a hook (`scripts/guard-features.mjs`, Node.js) rejects edits to `.slice/features.json` other than `passes`, and shell commands that name the file in anything but a read. After every shell command it compares the file with the `slice: plan` commit and tells the builder to restore it when more than `passes` changed.
