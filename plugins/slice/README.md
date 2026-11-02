# slice

slice plans bigger work as a product spec plus an end-to-end feature list, then lets one long Claude Code session build it. A feature counts as done only after its E2E steps ran against the running app and the evidence is in the conversation. It builds on Claude Code's `/goal`, `/verify`, `/code-review` and the official Playwright plugin.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code | the plugin and the builder sessions | `claude --version` |
| git | run branch, diffs, commits | `git --version` |
| Node.js | the Playwright plugin, which slice installs as a dependency (`npx @playwright/mcp`) | `node --version` |
| gh | issue planning in `/slice:shape`, `/slice:run #<n>` and PR delivery; optional for files only | `gh auth status` |


## Setup

1. Install from the cflow marketplace: `/plugin install slice@cflow`.
2. Run `/slice:setup` in the repo. It writes the marker `.claude/slice.json`, writes the run settings `.claude/slice-run.json` and audits the repo. If there is no recorded run recipe yet, it suggests running Claude Code's `/run-skill-generator` (or `/verify` once) so builders follow it instead of guessing how to start the app.

## Use

- **Small ticket.** slice stays out of it. With a recorded `verify` skill in the repo, Claude Code runs it before each commit on its own.
- **Bigger work.** `/slice:shape` plans it. Quick mode asks at most 6 questions (a ticket); deep mode has no limit and ends only when no clarification is open, every feature has executable E2E steps and you confirmed a summary (an epic or milestone). In existing code it runs `Explore` first and puts the summary in the epic. In a new app the first feature is a walking skeleton: the app starts with one documented command and the core path runs end to end.
- **Where the plan goes.** With a GitHub remote and a working `gh`, shape offers to create issues. Without, it writes `.slice/spec.md` and `.slice/features.json`. Review them, then run `/slice:run`.

`/background` detaches the session while the run goes on.

## Issue formats

All calls use the REST API through `gh api`.

- **Epic.** Label `slice`. Body: `## Spec` (product-level spec) and optionally `## Context` (summary of the existing code). Its sub-issues are the features, in build order.
- **Feature or ticket.** Label `slice`, plus `ui` for features with screens. Body: `## E2E steps` as a `- ` list of what a user does and sees, with concrete inputs and expected output; optionally `## Notes`.
- **Milestone.** Holds epics and/or tickets.

## `/slice:run`

`/slice:run [#<n> | milestone:<n>] [epic-pr | issue-prs]`

- **Source.** `#<n>` is an epic or a ticket, `milestone:<n>` all its open issues. `scripts/issues-to-files.sh` turns them into `.slice/spec.md` and `.slice/features.json`, copying the steps verbatim, and the run commits both as `slice: plan from #<n>`. They stay in the PR as the record of what was built. Without an argument the run uses the existing `.slice` files.
- **Readiness gate.** Before the builder starts, the run checks that every feature has steps with a concrete action and an observable result, that the app can be started (recorded recipe, README or a walking skeleton), that the Playwright plugin is enabled for features with screens, that `.claude/slice-run.json` exists, that budget, turn limit and run budget resolve, and that the delivery mode is known (for issues, `gh auth status` works). On a gap it lists everything, points to `/slice:shape` or `/slice:setup`, and stops without cost.
- **Acceptance.** When the builder reports every feature passed, the run starts Claude Code's `/verify` in a fresh session, sandboxed like the builder, on every feature's steps. A failure goes back to the builder once; a second failure halts the run with the list.
- **Needs decision.** The builder cannot reach GitHub. It writes owner-only questions (direction, stack, architecture, UX, anything irreversible) to `.slice/progress.md` under `## Needs decision`, leaves that feature open and moves on. After the run each question becomes a comment on the feature's issue with the label `needs-decision`.
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
| Builder output (`worker.json`, `worker.err`) | `~/.cache/slice/<repo>/` (or under `XDG_CACHE_HOME`) |

## Limits

- The builder runs sandboxed with `failIfUnavailable`. Network is limited to the package registries plus `allowedDomains`, and commands in `excludedCommands` run unsandboxed.
- On a cloud VM (`CLAUDE_CODE_REMOTE=true`) the run uses the profile without sandbox. Cloud runs aren't tested end to end for this version.
- Nothing stops the builder from editing `.slice/features.json` beyond `passes`; the instruction is in the goal and the skill.
