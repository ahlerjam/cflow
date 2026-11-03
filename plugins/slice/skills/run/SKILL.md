---
name: run
description: Runs a saved slice plan with a separate builder session in its own git worktree and run branch, checks readiness first, resumes after turn stops, gates on the tests, fast-forwards the agent branch, logs decisions and the changelog. Also lists, changes, deletes, stops and reports on plans. Use when the person starts a plan after the start question or asks to start, stop or list plans, ask how far a run is, or turn a decision into a plan.
when_to_use: /slice:run, "start plan", "show my plans", "zeig meine Pläne", "plan decision", "stop the run", "stop plan <id>", "Lauf stoppen", "how far is the run?", "wie weit ist der Lauf?", "Plan starten", "Plan löschen", "Plan ändern".
---
Slice's plans live on the agent branch under `.slice/plans/<id>/`. The builder is a separate `claude -p` process with a
`/goal`. This session only prepares the run, starts the builder, resumes it, merges and reports; it builds nothing
itself. Everything happens in git worktrees; the person's checkout is never switched or modified. Never work on the
repo's default branch.

Terms: `<repo>` is the person's checkout (`$CLAUDE_PROJECT_DIR`); the marker is `<repo>/.claude/slice.json`
(`agentBranch`, `testCommand`, `startCommand`, `maxTurns`, `budgetUsd`, `changelogDoc`). `<out>` is
`${XDG_CACHE_HOME:-$HOME/.cache}/slice/<repo dir name>/` (`mkdir -p`); the builder must not write into `.git`.
`<agent>` is the worktree `<out>/agent` on the agent branch, `<run>` is `<out>/run-<id>` on `slice/run-<id>`. No marker:
say to set slice up (`setup` skill) and stop.

## Requests
- "show my plans": list every `<agent>/.slice/plans/*/` with id, first line of `spec.md`, state and feature progress
  (passes of total). Create the agent worktree first when missing (step 2).
- "start plan <id>", or the start question's `Start now`: run the plan (flow below). Several plans: run dependent ones
  one after another; independent ones also run one after another for now, as a queue. Say so and set the waiting plans
  to `queued`; start the next one when a run ends. Parallel runs come later.
- Change or delete a plan: edit or delete its folder in `<agent>` and commit. A changed `spec.md` or `features.json`
  is committed as `slice: plan <id>` again (the guard compares against the latest such commit). Other changes:
  `slice: update <id>`. Never change a running plan.
- "plan decision D<n>: <instructions>": read entry `D<n>` in `<agent>/.slice/decisions.md`, then invoke the `shape`
  skill in quick mode with the entry and the instructions; the result is a new, independent plan.
- "stop" / "stopp": stop the builder's background task (TaskStop; else `pkill -f <session uuid>`), set `state.json` to
  `halted` with the reason "stopped", send the halt notification (step 8) and keep the run worktree for a later resume.
  Queued plans stay queued unless the person says otherwise.
- "how far is the run?": read `<run>/.slice/plans/<id>/features.json` and `git -C <run> log --oneline`; report passes
  of total and the last commit, in one or two lines. Without a run worktree, report `<agent>/.slice/plans/<id>/state.json`.
- Restart of a `halted`, `partial` or stopped plan: if `<run>` exists, resume the builder with `--resume <sessionId>`
  from `state.json` (resume rules in step 6). Otherwise `git worktree add <run> slice/run-<id>` (no `-b`) and resume.

## Flow
State changes are committed in `<agent>` as `slice: state <id> <state>`. Only the `shape` and `run` skills write
`state.json`, never the builder:
`{"state": "parked|queued|running|done|partial|halted", "runBranch": ..., "sessionId": ..., "started": ...,
"finished": ...}`.

1. Readiness gate. Check all before any builder starts. On any failure list every gap, name `shape` for gaps in the
   plan and `setup` for the others, and stop: no builder, no cost, state unchanged.
   - a. Done is defined: every feature has at least one step with a concrete action and an observable expected
     result. Judge each step; "works correctly" or "handle edge cases" fail. List the feature and step.
   - b. It can run the app: `startCommand` in the marker, a project skill `verify` or `run-<name>` in
     `.claude/skills/`, the README, `Makefile` or package scripts, or the first feature is a walking skeleton. For
     features marked `ui`, the Playwright plugin is installed and enabled (`claude plugin list`). Not a gate: if no
     language server plugin (`*-lsp`) is enabled for the repo's main language, say so and name `setup`.
   - c. What it may touch: `<repo>/.claude/slice-run.json` exists.
   - d. What stops it: `maxTurns` (default 400) resolves to a number. `budgetUsd` is optional and has no default: only
     when it is set (for test runs) does the run get a dollar cap.
   - e. It can be tested: `testCommand` is in the marker. The env var names under `## Access` in `spec.md` are set in
     the environment or in `<repo>/.env` (check names only, never print values). Missing ones are no gap: note them;
     the builder uses fakes.
2. Agent worktree. Create `<agent>` if missing (`git worktree add <out>/agent <agentBranch>`; the branch comes from
   `setup`; stop if it equals the default branch or is checked out in `<repo>`). With a remote: `git fetch origin`.
   Merge the repo's default branch into the agent branch (`git -C <agent> merge --no-edit <default>`; only read on the
   default branch). A conflict: `git -C <agent> merge --abort`, go on without the merge and record a decision.
3. Run worktree. Generate `<uuid>` (lowercase `uuidgen`) first. Set `state.json` to `running` (runBranch, sessionId,
   started) and commit it in `<agent>`, so the run branch contains it. Then
   `git worktree add -b slice/run-<id> <run> <agentBranch>`.
4. Settings file: `<repo>/.claude/slice-run.json`, except when the env var `CLAUDE_CODE_REMOTE` is `true` (cloud VM, no
   sandbox): then `${CLAUDE_PLUGIN_ROOT}/profiles/cloud.json`.
5. Start the builder in `<run>` with Bash, `run_in_background: true` and `timeout: 7200000` (2 hours; the default of
   10 minutes would kill it):

   ```
   cd <run> && SLICE_RUN=1 SLICE_PLAN=<id> claude -p '<GOAL>' --output-format json --model opus --fallback-model sonnet --effort <E> --session-id <uuid> --max-turns <maxTurns> --permission-mode dontAsk --permission-prompts none --settings <settings> > <out>/<id>-worker.json 2> <out>/<id>-worker.err
   ```

   `<uuid>` is the session id from step 3. Add `--plugin-dir "$SLICE_PLUGIN_DIR"` only if that env var is set. Only when `budgetUsd` is
   set, add `--max-budget-usd` with 0.8 x `budgetUsd` for the first call. `<E>` is `medium`; it rises to `high` for a
   resume after a call that added no newly passing feature, and stays there.
   `<GOAL>` is this text, with `<id>` and `<maxTurns>` filled in (it contains no single quote):

   `/goal Done means: every feature in .slice/plans/<id>/features.json has passes true, and the finish steps of the slice skill ran: /simplify, /code-review (and /security-review when the slice skill requires it), a full E2E run with its output shown after the last code change, and for screens a screenshot of each view at 360 and 1280 px. Follow the slice skill. Never change anything in .slice/plans/<id>/features.json except passes. You have at most <maxTurns> turns.`

   Do not poll; wait for the completion notice. Tell the person once that the run started.
6. On exit read `<out>/<id>-worker.json`: `subtype`, `total_cost_usd`. `total_cost_usd` is cumulative for the session,
   so the run's spend is its latest value; never sum calls. Count features with `passes: true` in
   `<run>/.slice/plans/<id>/features.json`.
   All features pass, whatever the `subtype` (a call can stop on its cap right after the last step):
   - No feature marked `ui`: go to step 7.
   - Otherwise acceptance (with `budgetUsd` set, only if at least 0.5 $ of it is left; else note it was skipped for
     budget and go to step 7). Run Claude Code's own `/verify` as an independent check, sandboxed like the builder,
     `run_in_background: true`, `timeout: 3600000`:
     `cd <run> && claude -p '/verify Start the app from the recorded recipe or the README, then run every E2E step of every feature in .slice/plans/<id>/features.json against it. Build nothing and do not follow the slice skill. For screens use the Playwright browser tools, never a Playwright script in Bash: Chromium cannot start inside the sandbox. Change no files. End with one line per feature: f<k> PASS, or f<k> FAIL and the reason.' --output-format json --model sonnet --permission-mode dontAsk --permission-prompts none --settings <settings> > <out>/<id>-accept.json 2> <out>/<id>-accept.err`.
     With `budgetUsd` set, add `--max-budget-usd` = `budgetUsd` minus the spend. Add its cost to the spend. Every
     feature PASS: go to step 7. Any FAIL: resume the builder (as below) with the
     prompt `<GOAL> Independent acceptance failed: <the FAIL lines>. Fix, verify again with evidence, and set passes false for any feature that does not hold.`,
     then run acceptance again. A second acceptance with FAIL lines: halt and list them in the changelog entry.
   Features still false and `subtype` is `error_max_turns`, `error_max_budget_usd` or `success`, or the worker file
   is empty because the process was killed (timeout, crash):
   - Two resumes in a row added no newly passing feature: halt.
   - `budgetUsd` set and spend >= `budgetUsd`, or less than 1 $ of it left: halt.
   - Otherwise resume with the same command, but `claude -p --resume <uuid> '<GOAL>'` instead of `--session-id`
     (setting the goal again also restores it if an error cleared it). With `budgetUsd` set, `--max-budget-usd` =
     0.7 x (`budgetUsd` - spend), rounded to cents; the cap is checked between turns, so a call overshoots it by its
     last turn, and the 30 % is headroom. Wait as in step 5.
   - Anything else (other subtype, or `--resume` fails): halt and keep the tail of `<out>/<id>-worker.err`.
   On a halt, first send the halt notification (step 8), then go on to step 7 when at least one feature passed; with
   none, set `state.json` to `halted`, write the decisions (step 7 without the merge) and finish.
7. Gate on the run branch, in `<run>`: merge the current agent branch (`git merge --no-edit <agentBranch>`; a conflict
   is a red gate), then run `testCommand` (and the E2E file, if `testCommand` does not cover it).
   - Green: copy the entries under `## Needs decision` of `progress.md` into `<run>/.slice/decisions.md`, numbered
     `D<n>` across the repo, each as `- D<n> (plan <id>) f<k>: <question>` with its `Interim:` and `Options:` lines.
     Set `state.json` to `done` (all passed) or `partial`, with `finished`. Commit as `slice: done <id>`; the message
     is the report summary plus the changelog link, or the full report without doc access (see Report). Then
     `git -C <agent> merge --ff-only slice/run-<id>`.
   - Red: no merge. Set `state.json` to `halted` in `<agent>`, write the decisions there, send the halt notification
     with the failing test as reason, and put the tail of the failing output in the changelog entry.
8. Finish. Push the agent branch when the repo has a remote (`git -C <agent> push origin <agentBranch>`, never force;
   a failed push is reported, not fatal). Remove the run worktree (`git worktree remove --force <run>`); keep the
   branch. Write the changelog entry. Start the next queued plan, if any. Your last chat message is exactly one line, for
   example `Done: 13/13 features merged to agent, report: <changelog link or merge commit>`. No list, no details, no
   hints: the report lives in the changelog and the merge commit.
   Notifications: after each finished feature the builder sends one itself. Send the halt notification
   here, immediately on a halt, with the reason, using the PushNotification tool if it is available (skip silently
   otherwise). slice has resumed on its own first (step 6); a halt means that did not help.

## Report
The same content goes to the changelog entry and the merge commit:
- What works now: one line per passed feature in the user's words, with the evidence (command and output, or
  screenshot name).
- Decisions for the user: the new `D<n>` entries, and features left open with the reason.
- Technical details: plan id, run branch, passed of total, acceptance result (if it ran), spend in $ (from
  `total_cost_usd`; for information, not a limit), number of resumes, the `permission_denials` from the worker file
  (offer to allow them in `.claude/slice-run.json`), the halt reason, and any `## Recipe changes` from `progress.md`
  (offer to apply them to the recorded recipe).

## Changelog doc
Needs the Claude Docs connector in this session (name no tool; use whatever the connector offers). Without it, skip:
the merge commit carries the full report. With it, add the entry at the top of the doc whose link is `changelogDoc` in
the marker; when the field is missing, create the doc, then store the link in the marker. Newest run on top. Agents
never read this doc.
