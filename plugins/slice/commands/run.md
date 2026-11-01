---
description: Builds the planned features unattended in a worktree, then ends the run as a PR, stacked PRs, a merge or a branch.
argument-hint: "[pr|feature-prs|merge|branch]"
allowed-tools: Bash, Read, AskUserQuestion, mcp__slice__slice
disable-model-invocation: true
---
Run the feature list in `.slice/features.json`. This session drives the loop; the builder is a separate `claude -p`
process in a worktree. The tool `mcp__slice__slice` does the mechanics. If it is missing, tell the person to run
`/slice:setup` and stop.

1. If `.slice/spec.md` or `.slice/features.json` is uncommitted (`git status --porcelain .slice`), commit only those
   files as `slice: plan`.
2. End mode: the argument `$ARGUMENTS` if it is one of `pr`, `feature-prs`, `merge`, `branch`; else `end` from
   `.claude/slice.json`; else ask once with AskUserQuestion (recommended first: `pr`). Ask nothing else during the run.
3. Call the tool with `action: "worker"`. It returns `cwd` and `command`. On an `error:` reply tell the person and stop.
4. Run `command` exactly as returned (it starts with `cd` into the worktree) with Bash, `run_in_background: true`,
   without a timeout. Do not poll; wait for the
   completion notice. Tell the person once that the run started and that `/background` detaches this session.
5. When the command exits, call the tool with `action: "check"`. It reads the builder's output file itself. Follow
   the returned `action`:
   - `resume`: call `action: "worker"` with `resume` set to the returned `session_id`, then go to step 4.
   - `finish`: call `action: "finish"` with the end mode, then report its summary and stop.
   - `halt`: tell the person the `reason`, `passed` of `total` and `costUsd`, and stop. The worktree stays for
     inspection; the person decides what next.
6. If `finish` returns an `error:`, report it as given and stop; the worktree stays.
