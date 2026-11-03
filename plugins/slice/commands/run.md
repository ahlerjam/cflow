---
description: Builds the planned features in one long builder session, from GitHub issues or from .slice files, checks readiness first, resumes after budget or turn stops, delivers draft PRs and reports.
argument-hint: "[#<n> | milestone:<n>] [epic-pr | issue-prs] [accept]"
allowed-tools: Bash, Read
disable-model-invocation: true
---
Run the feature list in `.slice/features.json`. The builder is a separate `claude -p` process with a `/goal`. This
session only prepares the run, starts the builder, resumes it, delivers and reports; it builds nothing itself. The
builder works from the two files and cannot reach GitHub (sandbox); everything on GitHub happens here. All GitHub
calls use REST through `gh api`, never `gh issue` or `gh pr` (GraphQL fails in cloud sessions). Write every
comment and PR body to a file in `<out>` and pass it with `-F body=@<file>`, never inline: backticks in a quoted
shell string run as commands and blank out commit hashes.

Arguments: `#<n>` (an epic or a ticket) or `milestone:<n>` as the source, and the delivery mode `epic-pr` (default
for issue sources) or `issue-prs`. No source: use the existing `.slice/` files. The run ends with an independent `/verify`
acceptance when any feature is marked `ui`, or when the argument `accept` is given.

1. Source. The working tree must be clean (`git status --porcelain`), except `.slice/` when there is no source
   argument. Remember the base branch and base commit (`git rev-parse HEAD`).
   - With a source: get `<owner/repo>` from `gh repo view --json nameWithOwner --jq .nameWithOwner` (or, if that
     fails, from `git remote get-url origin`), then run
     `${CLAUDE_PLUGIN_ROOT}/scripts/issues-to-files.sh <owner/repo> <n or milestone:n>`. It writes `.slice/spec.md`
     and `.slice/features.json` from the issues (open features in build order, steps copied verbatim). If it fails,
     show its message and stop.
   - Without a source: require `.slice/features.json` and `.slice/spec.md`; if one is missing, say to run
     `/slice:shape` first and stop.
2. Readiness gate. Check all five before any builder starts. On any failure list every gap, name `/slice:shape` for
   the gaps in the plan and `/slice:setup` for the others, and stop: no builder, no cost. If step 1 wrote the
   `.slice/` files from issues, restore them first (`git checkout -- .slice` for tracked, delete untracked ones), so a
   later run starts from a clean tree.
   - a. Done is defined: every feature has at least one step with a concrete action and an observable expected
     result. Judge each step; "works correctly" or "handle edge cases" fail. List the feature and step.
   - b. It can run the app: a project skill `verify` or `run-<name>` exists in `.claude/skills/`, or the README,
     `Makefile` or package scripts say how to start it, or the first feature is a walking skeleton. For features
     marked `ui`, the Playwright plugin is installed and enabled (`claude plugin list`). Not a gate: if no language
     server plugin (`*-lsp`) is enabled for the repo's main language, say so in the report and name `/slice:setup`.
   - c. What it may touch: `.claude/slice-run.json` exists.
   - d. What stops it: `budgetUsd` (default 30), `maxTurns` (default 400) and `runBudgetUsd` (default 5 times
     `budgetUsd`) from `.claude/slice.json` resolve to numbers.
   - e. Where the result goes: the delivery mode is known. For an issue source, `gh auth status` works and the
     remote branch of the base exists (`git ls-remote --exit-code --heads origin <base branch>`).
3. Create and switch to the branch `slice/run-<YYYYMMDD-HHMM>` from the current branch. Commit `.slice/` (the
   changes only) as `slice: plan from #<n>` (milestone: `slice: plan from milestone <n>`; no source: `slice: plan`).
   These files stay in the PR as the record of what was built.
4. Settings file: `.claude/slice-run.json`, except when the env var `CLAUDE_CODE_REMOTE` is `true` (cloud VM, no
   sandbox): then `${CLAUDE_PLUGIN_ROOT}/profiles/cloud.json`.
5. Output dir `<out>` = `${XDG_CACHE_HOME:-$HOME/.cache}/slice/<repo dir name>/` (`mkdir -p`). The builder must not
   write into `.git`.
6. Start the builder from the repo root with Bash, `run_in_background: true` and `timeout: 7200000` (2 hours; the
   default of 10 minutes would kill it):

   ```
   cd <repo root> && SLICE_RUN=1 claude -p '<GOAL>' --output-format json --model opus --fallback-model sonnet --effort <E> --max-budget-usd <B> --max-turns <maxTurns> --permission-mode dontAsk --permission-prompts none --settings <settings> > <out>/worker.json 2> <out>/worker.err
   ```

   Add `--plugin-dir "$SLICE_PLUGIN_DIR"` only if that env var is set. `<B>` is min(`budgetUsd`, 0.8 × `runBudgetUsd`) for the first call. `<E>` is `medium`; it rises to `high` for a resume after a call that
   added no newly passing feature, and stays there.
   `<GOAL>` is this text, with `<maxTurns>` filled in (it contains no single quote, so it fits in single quotes):

   `/goal Done means: every feature in .slice/features.json has passes true, and the finish steps of the slice skill ran: /simplify, /code-review, and a full E2E run with its output shown after the last code change. Follow the slice skill. Never change anything in .slice/features.json except passes. You have at most <maxTurns> turns.`

   Do not poll; wait for the completion notice. Tell the person once that the run started and that `/background`
   detaches this session.
7. On exit read `<out>/worker.json`: `session_id`, `subtype`, `total_cost_usd`. `total_cost_usd` is cumulative for
   the session, so the run's spend is its latest value; never sum calls. Count features with `passes: true` in
   `.slice/features.json`.
   - All pass and `subtype` is `success`, no feature marked `ui` and no `accept` argument: go to step 8.
   - All pass and `subtype` is `success`, otherwise: acceptance. Run Claude Code's own `/verify` as an independent check,
     sandboxed like the builder, `run_in_background: true`, `timeout: 3600000`:
     `cd <repo root> && claude -p '/verify Run every E2E step of every feature in .slice/features.json against the running app. Change no files. End with one line per feature: f<k> PASS, or f<k> FAIL and the reason.' --output-format json --model sonnet --max-budget-usd <min(5, runBudgetUsd - spend)> --permission-mode dontAsk --permission-prompts none --settings <settings> > <out>/accept.json 2> <out>/accept.err`.
     Add its cost to the spend. Every feature PASS: go to step 8. Any FAIL: resume the builder (as below) with the
     prompt `Independent acceptance failed: <the FAIL lines>. Fix, verify again with evidence, and set passes false for any feature that does not hold.`,
     then run acceptance again. A second acceptance with FAIL lines: halt and list them in the report.
   - `subtype` is `error_max_budget_usd` or `error_max_turns`, or `success` with features still false:
     - spend >= `runBudgetUsd`: halt.
     - Two resumes in a row added no newly passing feature: halt.
     - Otherwise resume with the same command, but `claude -p --resume <session_id> '<GOAL>'` (setting the goal again
       also restores it if an error cleared it)
       and `--max-budget-usd` = min(`budgetUsd`, 0.7 × (`runBudgetUsd` - spend)), rounded to cents. The cap is checked
       between turns, so a call overshoots it by its last turn (reviews and subagents); the 30 % is headroom.
       Less than 1 $ left: halt instead. Wait as in step 6.
   - Anything else (no JSON, other subtype): halt and show the tail of `<out>/worker.err`.
   A halt still goes on to step 8 when at least one feature passed; with none, report only.
8. Owner questions. The builder writes them to `.slice/progress.md` under `## Needs decision` as `- f<k>: <question>`.
   For an issue source, map `f<k>` to its `issue` in `.slice/features.json`, post the question as a comment on
   that issue (`gh api repos/<o>/<r>/issues/<issue>/comments -F body=@<file>`) and add the label `needs-decision`
   (`gh api repos/<o>/<r>/issues/<issue>/labels -f 'labels[]=needs-decision'`). Create the label first if
   `gh api repos/<o>/<r>/labels/needs-decision` returns 404 (`POST repos/<o>/<r>/labels -f name=needs-decision -f color=d93f0b`).
   For a files-only source, only list the questions in the report.
9. Delivery, outside the sandbox; the builder never pushes. Never force-push.
   - Files-only source: branch only. Suggest `gh pr create`.
   - `epic-pr`: `git push -u origin <run branch>`, then one draft PR:
     `gh api repos/<o>/<r>/pulls -f title=... -f head=<run branch> -f base=<base branch> -F draft=true -F body=@<file>`.
     Body: summary, one line `Closes #<issue>` for every feature with `passes` true (and `Closes #<epic>` if all
     pass), the features still false with the reason from `progress.md`, the needs-decision list. Get the default
     branch with `gh api repos/<o>/<r> --jq .default_branch`. If the base branch is not it, say in the body and in
     the report that GitHub closes issues only on merge into the default branch.
   - `issue-prs`: one stacked draft PR per feature commit (`git log --reverse --grep '^slice: f' <base commit>..HEAD`).
     Branch `<run branch>-f<k>` at that commit (not `<run branch>/f<k>`: git cannot hold a branch and a branch
     folder of the same name). Push it, open the PR via the same `pulls` call. Its base is the previous feature
     branch, the first one's base is the base branch. Body: `Closes #<issue>`. Features still false get no PR.
     Say that stacked PRs close their issue only after the stack is retargeted to the default branch and merged.
   - For every feature issue that passed, post a comment: run branch, commit, "E2E steps passed in the run;
     evidence in the PR".
   If a push or API call fails, show the error, keep going with the rest and report what is missing.
10. Report: source, branch, base commit, passed of total, the acceptance result (if it ran), spend in $, number of resumes,
    the `permission_denials` from `worker.json` (what the builder was refused; offer to allow it in `.claude/slice-run.json`), the halt reason if there
    was one, PR links, the needs-decision list, any `## Recipe changes` from `progress.md` (offer to apply them to the recorded recipe), and that `.slice/spec.md` and `.slice/features.json` are in the PR
    as the record of what was built. Do not merge.
