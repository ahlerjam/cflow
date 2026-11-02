---
description: Starts one long builder session for the planned features, resumes it after budget or turn stops and reports.
allowed-tools: Bash, Read
disable-model-invocation: true
---
Run the feature list in `.slice/features.json`. The builder is a separate `claude -p` process with a `/goal`. This
session only starts it, resumes it and reports; it builds nothing itself.

1. Require `.slice/features.json` and `.slice/spec.md`; if one is missing, say to run `/slice:shape` first and stop.
   Require `.claude/slice-run.json`; if missing, say to run `/slice:setup` first and stop. If `.slice/` has
   uncommitted changes (`git status --porcelain .slice`), commit only those as `slice: plan`. The working tree must
   be clean otherwise; if not, say so and stop.
2. Create and switch to the branch `slice/run-<YYYYMMDD-HHMM>` from the current branch. Remember the base commit
   (`git rev-parse HEAD` before the switch).
3. Read `budgetUsd` (default 30), `maxTurns` (default 400) and `runBudgetUsd` (default 5 times `budgetUsd`) from
   `.claude/slice.json`.
4. Settings file: `.claude/slice-run.json`, except when the env var `CLAUDE_CODE_REMOTE` is `true` (cloud VM, no
   sandbox): then `${CLAUDE_PLUGIN_ROOT}/profiles/cloud.json`.
5. Output dir `<out>` = `${XDG_CACHE_HOME:-$HOME/.cache}/slice/<repo dir name>/` (`mkdir -p`). The builder must not
   write into `.git`.
6. Start the builder from the repo root with Bash, `run_in_background: true` and `timeout: 7200000` (2 hours; the
   default of 10 minutes would kill it):

   ```
   cd <repo root> && SLICE_RUN=1 claude -p '<GOAL>' --output-format json --model opus --fallback-model sonnet --effort high --max-budget-usd <B> --max-turns <maxTurns> --permission-mode dontAsk --settings <settings> > <out>/worker.json 2> <out>/worker.err
   ```

   Add `--plugin-dir "$SLICE_PLUGIN_DIR"` only if that env var is set. `<B>` is `budgetUsd` for the first call.
   `<GOAL>` is this text, with `<maxTurns>` filled in (it contains no single quote, so it fits in single quotes):

   `/goal Done means: every feature in .slice/features.json has passes true, and your final turns contain a full E2E pass of the steps of every feature, run with the verify skill against the running app, with the evidence shown in the conversation after the last code change. Follow the run routine of the slice skill (section "In a run session"). Order per feature: build, verify with evidence, then set passes and commit. Never change anything in .slice/features.json except passes. You have at most <maxTurns> turns; spend them on the features, not on polish.`

   Do not poll; wait for the completion notice. Tell the person once that the run started and that `/background`
   detaches this session.
7. On exit read `<out>/worker.json`: `session_id`, `subtype`, `total_cost_usd`. `total_cost_usd` is cumulative for
   the session, so the run's spend is its latest value; never sum calls. Count features with `passes: true` in
   `.slice/features.json`.
   - All pass and `subtype` is `success`: go to step 8.
   - `subtype` is `error_max_budget_usd` or `error_max_turns`, or `success` with features still false:
     - spend >= `runBudgetUsd`: halt.
     - Two resumes in a row added no newly passing feature: halt.
     - Otherwise resume with the same command, but `claude -p --resume <session_id> 'Continue toward the goal.'`
       and `--max-budget-usd` = min(`budgetUsd`, `runBudgetUsd` - spend), rounded to cents. Wait as in step 6.
   - Anything else (no JSON, other subtype): halt and show the tail of `<out>/worker.err`.
8. Report: branch, base commit, passed of total, spend in $, number of resumes and the halt reason if there was one.
   Say that the person can open a PR with `gh pr create` or merge the branch. Do not push, open a PR or merge.
