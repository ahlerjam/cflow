---
name: run
description: Runs a saved slice plan with a separate builder session in its own git worktree and run branch, checks readiness first, resumes after turn stops, gates on the tests, fast-forwards the agent branch, logs decisions and the changelog. Also lists, changes, deletes, stops and reports on plans. Use when the person starts a plan after the start question or asks to start (here or in the cloud), stop or list plans, ask how far a run is, or turn a decision into a plan.
when_to_use: /slice:run, "start plan", "show my plans", "zeig meine Pläne", "plan decision", "stop the run", "stop plan <id>", "Lauf stoppen", "how far is the run?", "wie weit ist der Lauf?", "Plan starten", "Plan löschen", "Plan ändern", "start plan <id> in the cloud", "in der Cloud starten".
---
Slice's plans live on the agent branch under `.slice/plans/<id>/`. The builder is a separate `claude -p` process with a
`/goal`. This session only prepares the run, starts the builder, resumes it, merges and reports; it builds nothing
itself. Everything happens in git worktrees; the person's checkout is never switched or modified. Never work on the
repo's default branch.

Terms: `<repo>` is the person's checkout (`$CLAUDE_PROJECT_DIR`); the marker is `<repo>/.claude/slice.json`
(`agentBranch`, `testCommand`, `startCommand`, `maxTurns`, `budgetUsd`, `changelogDoc`, `cloudPluginRef`). `<out>` is
`${XDG_CACHE_HOME:-$HOME/.cache}/slice/<repo dir name>/` (`mkdir -p`); the builder must not write into `.git`.
`<agent>` is the worktree `<out>/agent` on the agent branch, `<run>` is `<out>/run-<id>` on `slice/run-<id>`. No marker:
say to set slice up (`setup` skill) and stop.

## Requests
- "show my plans": list every `<agent>/.slice/plans/*/` with id, first line of `spec.md`, state and feature progress
  (passes of total). Create the agent worktree first when missing (step 2).
- "start plan <id>", or the start question's `Start now`: run the plan (flow below). Several plans: run dependent ones
  one after another; independent ones also run one after another for now, as a queue. Say so and set the waiting plans
  to `queued`; start the next one when a run ends. Parallel runs come later.
- "start plan <id> in the cloud", or the start question's `Start in the cloud`: the cloud start (section below). Not
  in a cloud session (`CLAUDE_CODE_REMOTE=true`): there the plan simply runs (flow below).
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
  A plan whose `state.json` says `"where": "cloud"`: `git -C <agent> fetch origin <agentBranch>`, then report from
  `origin/<agentBranch>` (`git show origin/<agentBranch>:.slice/plans/<id>/state.json` and `features.json`: state, passes
  of total) and add the `cloudSession` URL. The run branch lives only in the cloud VM until it is merged.
- Restart of a `halted`, `partial` or stopped plan: if `<run>` exists, resume the builder with `--resume <sessionId>`
  from `state.json` (resume rules in step 6). Otherwise `git worktree add <run> slice/run-<id>` (no `-b`) and resume.

## Flow
State changes are committed in `<agent>` as `slice: state <id> <state>`, one commit per change: write `state.json`
once with all its fields (read the current file first and keep `started`, `sessionId` and `runBranch` when only
`state` and `finished` change), and skip the commit when the file already holds that state. Only the `shape` and `run`
skills write `state.json`, never the builder:
`{"state": "parked|queued|running|done|partial|halted", "runBranch": ..., "sessionId": ..., "started": ...,
"finished": ...}`. A cloud plan also has `"where": "cloud"` and, once started, `"cloudSession": "<url>"`; keep both
whenever the file is rewritten.

1. Readiness gate. Read the marker again right before it, on every run: its values may have changed since the session
   started. Check all before any builder starts. On any failure list every gap, name `shape` for gaps in the
   plan and `setup` for the others, and stop: no builder, no cost, state unchanged.
   - a. Done is defined: every feature has at least one step with a concrete action and an observable expected
     result. Judge each step; "works correctly" or "handle edge cases" fail. List the feature and step.
   - b. It can run the app: `startCommand` in the marker, a project skill `verify` or `run-<name>` in
     `.claude/skills/`, the README, `Makefile` or package scripts, or the first feature is a walking skeleton. For
     features marked `ui`, `npx` is on `PATH` (`command -v npx`); the run brings its own headless
     browser server. Not a gate: if no
     language server plugin (`*-lsp`) is enabled for the repo's main language, say so and name `setup`.
   - c. What it may touch: `<repo>/.claude/slice-run.json` exists. Skipped when `CLAUDE_CODE_REMOTE` is `true` or for
     a cloud start: the cloud profile is used there.
   - d. What stops it: `maxTurns` (default 400) resolves to a number. `budgetUsd` is optional and has no default: only
     when it is set (for test runs) does the run get a dollar cap.
   - e. It can be tested: `testCommand` is in the marker. The env var names under `## Access` in `spec.md` are set in
     the environment or in a file that step 3 copies into the run worktree (`<repo>/.env`, or the files that
     `<repo>/.worktreeinclude` lists), check names only, never print values. For a cloud start only variables of the
     cloud environment count; the person's `.env` is not there. Missing ones are no gap: note them (for the cloud:
     set them as environment variables of the cloud environment); the builder uses fakes.
2. Agent worktree. Create `<agent>` if missing (`git worktree add <out>/agent <agentBranch>`; the branch comes from
   `setup`; stop if it equals the default branch or is checked out in `<repo>`). With a remote: `git fetch origin`.
   Merge the repo's default branch into the agent branch (`git -C <agent> merge --no-edit <default>`; only read on the
   default branch). A conflict: `git -C <agent> merge --abort`, go on without the merge and record a decision.
3. Run worktree. A plan that is already `queued` or `running` with `"where": "cloud"` is startable inside the cloud
   session (`CLAUDE_CODE_REMOTE=true`): this step rewrites `state.json` as `running` with the new `runBranch`,
   `sessionId` and `started` and keeps `where` and `cloudSession`. Run `uuidgen` (lowercase) first and keep the result as `<uuid>`. Only then write `state.json` once
   as `running` with `runBranch`, `sessionId` = `<uuid>` and `started`, and commit it in `<agent>` as the single
   `slice: state <id> running` commit, so the run branch contains it. Never commit it before the session id is known
   and never amend it with a second commit. Then
   `git worktree add -b slice/run-<id> <run> <agentBranch>`.
   Required before step 5, never skipped: copy the person's gitignored files into `<run>`. A worktree made with
   `git worktree add` gets no `.worktreeinclude` treatment from Claude Code, so do it yourself, in one Bash call:
   - `<repo>/.worktreeinclude` exists (`.gitignore` syntax): the files to copy are
     `git -C <repo> ls-files -o -i --exclude-from=.worktreeinclude | git -C <repo> check-ignore --stdin`
     (matches that are untracked and gitignored); `cp -p` each to the same relative path in `<run>`.
   - No such file: copy `<repo>/.env` if it exists and `git -C <repo> check-ignore -q .env` succeeds.
   Never copy a file that is not gitignored, never `git add` a copied file, never print one. Afterwards `ls -a <run>`
   shows `.env`. Not in a cloud session: there the environment's variables apply.
4. Settings file: `<repo>/.claude/slice-run.json`, except when the env var `CLAUDE_CODE_REMOTE` is `true` (cloud VM, no
   sandbox): then `${CLAUDE_PLUGIN_ROOT}/profiles/cloud.json`. Browser: when any feature is marked `ui`, `<mcp>` is
   ` --mcp-config "${CLAUDE_PLUGIN_ROOT}/mcp/playwright.json"` (a headless Playwright server, tools
   `mcp__playwright__*`; the profiles switch off the Playwright plugin so no second, headed browser exists).
   Library docs: when `claude mcp get context7` fails (no `context7` server is configured for the person), or in a
   cloud session, add `"${CLAUDE_PLUGIN_ROOT}/mcp/context7.json"` to `<mcp>` (Context7 over HTTP; it uses the env var
   `CONTEXT7_API_KEY` when set and works without it at lower rate limits). Several files go after one `--mcp-config`,
   separated by spaces. Without either, `<mcp>` is empty.
5. Start the builder in `<run>` with Bash, `run_in_background: true` and `timeout: 7200000` (2 hours; the default of
   10 minutes would kill it):

   ```
   cd <run> && SLICE_RUN=1 SLICE_PLAN=<id> claude -p '<GOAL>' --output-format stream-json --verbose --model opus --fallback-model sonnet --effort <E> --session-id <uuid> --max-turns <maxTurns> --permission-mode dontAsk --permission-prompts none --settings <settings> --plugin-dir "${SLICE_PLUGIN_DIR:-${CLAUDE_PLUGIN_ROOT}}"<mcp> > <out>/<id>-worker.jsonl 2> <out>/<id>-worker.err
   ```

   `<uuid>` is the session id from step 3. `--plugin-dir` always loads the plugin from the directory this session
   runs from (or `SLICE_PLUGIN_DIR`, the cloud checkout); a same-named installed copy is replaced silently, never
   loaded twice, so the builder has the slice skill and its guard hook whatever the install state. Never use `--bare`: it
   skips the hooks, skills and plugin settings the run relies on. Only when `budgetUsd` is
   set, add `--max-budget-usd` with 0.8 x `budgetUsd` for the first call. `<E>` is `medium`; it rises to `high` for a
   resume after a call that added no newly passing feature, and stays there.
   `<GOAL>` is this text, with `<id>` and `<maxTurns>` filled in (it contains no single quote):

   `/goal Done means: every feature in .slice/plans/<id>/features.json has passes true, and the finish steps of the slice skill ran: /simplify, /code-review on the plan's diff (and /security-review when the slice skill requires it), a full E2E run with its output shown after the last code change, and for screens a screenshot of each view at 360 and 1280 px. Follow the slice skill. Never change anything in .slice/plans/<id>/features.json except passes. You have at most <maxTurns> turns.`

   Load check, right after the start: wait until `<out>/<id>-worker.jsonl` holds a line with `"subtype":"init"` (check
   every 2 s for at most 60 s; `grep -m1 '"subtype":"init"'`). Read that line's `plugins` (names) and
   `mcp_servers` (name and status). The check fails when `slice` is not among the plugins, when a `plugin_errors` entry names `slice`
   (other plugins' errors are ignored: the run settings switch the Playwright plugin off, which `plugin_errors` reports
   for plugins that depend on it), or, for a plan with a `ui` feature, when no `playwright` server has the status `connected`. A `context7` server
   that is not connected does not fail the check; note it in the report. A failed check: stop the
   builder (TaskStop; else `pkill -f <uuid>`), set `state.json` to `halted` with the reason (for example "plugin
   slice not loaded: <plugin_errors>" or "playwright MCP server not connected"), send the halt notification (step 8),
   go on as a halt with no passing feature (step 6, last paragraph), and do not resume. No `init` line within 60 s
   counts as failed too.
   Otherwise do not poll; wait for the completion notice. Tell the person once that the run started.
6. On exit read the last line of `<out>/<id>-worker.jsonl` that holds `"type":"result"` (`grep '"type":"result"'
   <out>/<id>-worker.jsonl | tail -1`): `subtype`, `total_cost_usd`, `permission_denials`, `session_id`.
   `total_cost_usd` is cumulative for the session, so the run's spend is its latest value; never sum calls. Count
   features with `passes: true` in `<run>/.slice/plans/<id>/features.json`.
   All features pass, whatever the `subtype` (a call can stop on its cap right after the last step):
   - Acceptance, for every plan (with `budgetUsd` set, only if at least 0.5 $ of it is left; else note it was skipped for
     budget and go to step 7). Run Claude Code's own `/verify` as an independent check, sandboxed like the builder,
     `run_in_background: true`, `timeout: 3600000`:
     `cd <run> && claude -p '/verify Start the app from the recorded recipe or the README, then run every E2E step of every feature in .slice/plans/<id>/features.json against it, at its real surface: a command-line tool in the terminal, an API with requests, screens in the browser. Then probe the unhappy paths that .slice/plans/<id>/spec.md and its quality bar name (invalid, empty, long or repeated input); a real defect there is a FAIL for the feature it belongs to. Build nothing and do not follow the slice skill. For screens use the Playwright browser tools (`mcp__playwright__*`), never a Playwright script in Bash: Chromium cannot start inside the sandbox. Change no files. End with one line per feature: f<k> PASS, or f<k> FAIL and the reason.' --output-format json --model sonnet --permission-mode dontAsk --permission-prompts none --settings <settings><mcp> > <out>/<id>-accept.json 2> <out>/<id>-accept.err`.
     With `budgetUsd` set, add `--max-budget-usd` = `budgetUsd` minus the spend. Add its cost to the spend. Every
     feature PASS: go to step 7. Any FAIL: resume the builder (as below) with the
     prompt `<GOAL> Independent acceptance failed: <the FAIL lines>. Fix, verify again with evidence, and set passes false for any feature that does not hold.`,
     then run acceptance again. A second acceptance with FAIL lines: halt and list them in the changelog entry.
   Features still false and `subtype` is `error_max_turns`, `error_max_budget_usd` or `success`, or the worker file
   has no `result` line because the process was killed (timeout, crash):
   - Two resumes in a row added no newly passing feature: halt.
   - `budgetUsd` set and spend >= `budgetUsd`, or less than 1 $ of it left: halt.
   - Otherwise resume with the same command (including `--plugin-dir`, the load check and the `.jsonl` output), but `claude -p --resume <uuid> '<GOAL>'` instead of `--session-id`
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

## Cloud start
Only when `<repo>` has a GitHub remote (`git remote get-url origin` contains `github.com`) and `CLAUDE_CODE_REMOTE` is
not `true`: a cloud session never starts another cloud run; it runs the plan itself.

1. Readiness gate as in step 1 (check c skipped), plus: the remote exists, and the person's current branch exists on
   origin (`git -C <repo> ls-remote --exit-code --heads origin <branch>`). Otherwise go to C below with the note that
   this branch must be pushed first; never push the person's branch yourself.
2. Step 2 (agent worktree, merge the default branch). Write `state.json` as `queued` with `"where": "cloud"` and
   commit it once as `slice: state <id> queued`. Push the agent branch (`git -C <agent> push origin <agentBranch>`,
   never force). The push is required and runs as its own Bash call, never chained with later steps: GitHub sometimes
   answers 500, so retry up to 4 times with 20 s pauses, verify with `git ls-remote origin <agentBranch>` that origin
   has the commit, and on a final failure stop with the error. Start no cloud session before that.
3. Write the task to `<out>/<id>-cloud-task.txt`, with `<id>`, `<agentBranch>`, `<cloudPluginRef>` and `<marker>`
   (the marker file's content, one line of JSON) filled in. `<cloudPluginRef>` is the marker field `cloudPluginRef`
   when set, else `slice--v<version>` with the version from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`:

   ```
   You are only a launcher. Change nothing in this repository yourself and create no commits.
   1. Run: git clone --depth 1 --branch <cloudPluginRef> https://github.com/ahlerjam/cflow /tmp/cflow
   2. If .claude/slice.json does not exist in the repository, create it with exactly this content: <marker>
   3. Start the run in the background with the longest background time limit (run_in_background true, timeout 7200000;
      without that timeout the limit is 30 minutes and cuts the run):
      SLICE_PLUGIN_DIR=/tmp/cflow/plugins/slice claude -p --plugin-dir /tmp/cflow/plugins/slice 'start plan <id>' --model sonnet --permission-mode dontAsk --allowedTools 'Bash,Read,Edit,Write,Glob,Grep,Skill' --output-format stream-json --verbose > /tmp/orch.jsonl 2>&1
   4. Stay active until it exits: loop with a Bash call that has timeout 600000 and the command
      "sleep 540; tail -c 400 /tmp/orch.jsonl", and check whether the background process is still running. The command
      must start with sleep: a foreground command that reaches its timeout is otherwise moved to the background, and a
      sleep command is stopped at the timeout instead, so give it that timeout (the default is 2 minutes). Do not create
      scheduled triggers, routines or cron jobs. Never kill the run before it exits.
   5. When it has exited, report the last line of /tmp/orch.jsonl that has "type":"result", and the output of
      git fetch origin <agentBranch> && git log --oneline -5 origin/<agentBranch>.
   ```
4. Start, in this order:
   - D. When `command -v expect` finds expect: from `<repo>` run
     `expect "${CLAUDE_PLUGIN_ROOT}/scripts/cloud-start.exp" <out>/<id>-cloud-task.txt <out>/<id>-cloud-start.log`
     with Bash, timeout 180000. It starts `claude --cloud`, an undocumented use of that command through a pty. Exit 0:
     stdout is the session URL. Write `state.json` as `running` with `"where": "cloud"`, `"cloudSession": "<url>"`,
     `started`, commit it (`slice: state <id> running`), push the agent branch (a failed push is reported, not
     fatal) and answer with exactly one line: `Started in the cloud: <url>`. Exit 1 (no URL within 120 s, or an
     error): C.
   - C. Tell the person one line to run in their terminal, in the repo: `claude --cloud "$(cat <out>/<id>-cloud-task.txt)" --permission-mode auto`.
     The state stays `queued` with `where: cloud`. After D failed, add that the automatic start failed
     (`<out>/<id>-cloud-start.log` has the output). With a branch not on origin, say it must be pushed first.

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
