# slice

Verification-first work loop for Claude Code. A small mod runs the proof itself, a fresh verifier checks the claim, and you accept the result. Work happens in thin vertical slices, sized to the task: a single ticket, a supervised feature, or later a whole stage.

## Requirements

| Software | Needed for | Check |
| --- | --- | --- |
| Claude Code 2.1.311 or later | the plugin and its mod | `claude --version` |
| git | state, worktrees and diffs | `git --version` |

Node.js and Playwright are only needed in repos with a UI.

## Install

```
/plugin install slice@cflow
```

## Usage

Run `/slice:setup` in a repo to opt in. Without `.claude/slice.json` the mod does nothing.

## Setup

Run `/slice:setup` once per repo.
