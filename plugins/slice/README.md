# slice

slice plans bigger work as a product spec plus an end-to-end feature list, then lets one long Claude Code session build it. A feature counts as done only after its E2E steps ran against the running app and the evidence is in the conversation. It builds on Claude Code's `/goal`, your project's verify recipe and `/code-review`.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code | the plugin and the builder sessions | `claude --version` |
| git | run branch, diffs, commits | `git --version` |
| gh | only for GitHub issues in `/slice:shape` | `gh auth status` |

Node.js is optional: `scripts/ui-check.mjs` uses it for screenshots of UI states.

## Setup

1. Install from the cflow marketplace: `/plugin install slice@cflow`.
2. Run `/slice:setup` in the repo. It writes the marker `.claude/slice.json`, writes the run settings `.claude/slice-run.json` and checks that `.claude/skills/verify/SKILL.md` exists. If it doesn't, record one with `/run-skill-generator` or `/verify` and run setup again.

## Use

- **Small ticket.** Just ask. Claude changes the code, runs the verify recipe, shows the evidence and commits only after that.
- **Bigger work.** `/slice:shape` interviews you (at most 6 questions) and writes `.slice/spec.md` and `.slice/features.json`, optionally one GitHub issue per feature. Review both files, then run `/slice:run`. When it ends, open a PR yourself with `gh pr create` or merge the run branch.

`/background` detaches the session while the run goes on.

## How a run works

`/slice:run` commits the plan, creates the branch `slice/run-<date>-<time>` and starts one `claude -p` builder session with a `/goal`: every feature has `passes` true and a final E2E pass of all features is shown. The builder works one feature at a time: build, verify with evidence, set `passes`, commit. A feature it can't finish stays `passes: false` with the reason in `.slice/progress.md`.

When the builder stops on its budget or turn limit, or reports success with features still open, the same session is resumed. The run halts when the spend reaches `runBudgetUsd`, when two resumes in a row add no passing feature, or on any other result. Each resume gets at most the remaining run budget. The command then reports branch, passed of total, spend and resumes. It does not push, open a PR or merge.

## Where things live

| What | Where |
| --- | --- |
| Marker: `budgetUsd` (30), `maxTurns` (400), `runBudgetUsd` (5 times `budgetUsd`), `allowedDomains`, `excludedCommands` | `.claude/slice.json` |
| Builder settings: the plugin's `profiles/run.json` plus the marker's domains and commands | `.claude/slice-run.json` |
| Spec, feature list, builder log | `.slice/spec.md`, `.slice/features.json`, `.slice/progress.md` |
| Builder output (`worker.json`, `worker.err`) | `~/.cache/slice/<repo>/` (or under `XDG_CACHE_HOME`) |

## Limits

- The builder runs sandboxed with `failIfUnavailable`. Network is limited to the package registries plus `allowedDomains`, and commands in `excludedCommands` run unsandboxed.
- On a cloud VM (`CLAUDE_CODE_REMOTE=true`) the run uses the profile without sandbox. Cloud runs aren't tested end to end for this version.
- Nothing stops the builder from editing `.slice/features.json` beyond `passes`; the instruction is in the goal and the skill.
