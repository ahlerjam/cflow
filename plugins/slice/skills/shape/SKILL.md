---
name: shape
description: Plans a piece of work as a product spec and a feature list with executable end-to-end steps after an interview sized to the work, saves it as a plan on the agent branch and asks whether to start it. Use when the person asks to build, add, change or fix something in a repo set up with slice (.claude/slice.json), or to plan before a run. Not for listing, starting, changing or deleting saved plans (run).
when_to_use: /slice:shape, "plan this", "build this", "fix this bug", "write a spec", "break this into features", "Feature planen", "baue", "ändere", "behebe", "Fehler beheben", "füge ... hinzu", "Spezifikation schreiben", "Arbeit in Features aufteilen".
---
Plan the work with the person. Read the repo first (README, docs, existing code) and the agent worktree's `.slice/`
if it exists. The agent worktree is `${XDG_CACHE_HOME:-$HOME/.cache}/slice/<repo dir name>/agent` on `agentBranch` from
the marker. Create it when missing with `git worktree add <path> <agentBranch>`; stop if `agentBranch` equals the
repo's default branch or is checked out in the person's checkout. The result is a plan: `spec.md` and `features.json` under `.slice/plans/<id>/` on the agent branch.
Nothing else is written, and the person's checkout is never switched or modified. Without the marker
`.claude/slice.json`, do not interview: say that slice must be set up first (`setup` skill) and stop.

## Mode
Estimate the size of the work first, then pick the mode and say which one you use.
- Quick: at most 6 questions. For a small change: one change in one place.
- Deep: no question limit. For anything bigger, and for any new app or tool, however small it sounds.

The person can override the mode. Deep mode ends only when all three hold: every
area of the coverage list is settled, every feature has executable E2E steps, and the person confirmed the summary.
Both modes end with the summary.

## Know-how
Before the interview, invoke the `practices` skill and load its `references/issues.md` plus the cookbook for each project
type the work is (CLI, web, API, library, data job), and its `references/architecture.md` for a new app. Add the
cookbook's coverage questions to the coverage list below.

## Interview
Never ask what the repo already answers. Where the options are clear, use AskUserQuestion, one question each, your
recommended option first. Ask open questions for the goal, the users and what "good" means. If AskUserQuestion is
unavailable, ask in plain text and end the turn. Say plainly when the person's idea has a weaker approach and why.

Deep mode works through the coverage list in rounds. Each area is settled when the person answered it or you decided
it and wrote the decision down as an assumption. Skip an area only when it cannot apply. Every answer can open new
questions; ask them in the next round. "You decide" settles that one question, never the interview.

Coverage list:
1. Goal, users, how they notice it works.
2. Core flows and their variants (kinds of items, schedules, roles).
3. Time and dates: time zones, when a day or week starts, past and future entries, gaps.
4. Data: what is stored, where, format, limits; import, export and their exact format.
5. Lifecycle: edit, undo, duplicates, rename, pause, archive, delete and its safeguard.
6. Errors: invalid input, missing or corrupt data, messages, exit codes or HTTP status.
7. Output: views, empty and long data, colors and when they are off, accessibility; the exact texts and number
   formats the person cares about (labels, messages, totals), written into the steps verbatim.
8. Testability: how a test fixes the current time, the data location and other inputs; name the exact switches.
9. Hard constraints: platform, install, performance, privacy.
10. Keys and access: env var names, accounts and services the work needs. Ask for them up front. Record the names
    (never values) under `## Access` in the spec. A missing key is no blocker: the builder builds against a fake.

Summary: before writing anything, show the planned features in one line each and every assumption you made as its
own line, and ask the person to confirm or correct. Apply corrections and show what changed.

Dependencies: after the summary, decide whether the new plan builds on plans that are not `done` yet. Read
`.slice/plans/*/state.json` and the specs in the agent worktree (fetch `origin/<agentBranch>` first with a remote, since
cloud runs write there). Ask only when it is unclear, with one AskUserQuestion naming the candidate plans.

## Existing code (brownfield)
Before the interview run the built-in `Explore` subagent on the affected area: modules, existing patterns, entry
points, risks. Its short summary goes into the spec under `## Context`.

## No app yet (greenfield)
The first feature is always a walking skeleton: the app starts with one documented command (README or `Makefile`)
and the core path runs thinly end to end. Its steps say so.

## Scope
Plan the complete product the person describes, not a minimal first cut, and skip nothing a user would expect. Suggest what would make it clearly better during the interview; plan it only when the person agrees.

## Spec
Product level only: the first line `Type: <cli|web|api|library|data-job>` (several if they apply), purpose, users, what they can do, the quality bar. No implementation details or file names. Owner decisions and every assumption from the summary (stack, storage, platform, conventions) go under `## Decisions`, so the builder never has to guess them. For screens, add the states that must exist (empty, loading, error, long data).

Add `## Access` (names only) when the work needs keys or services, and `## Quality bar` to the spec: the cookbook's quality bar items that apply, adjusted to what the person said. The
builder and the reviewers check against it.

## Features
- Order so each feature can be built and checked after the ones before it; the first feature runs the core path end to end, thinly.
- Steps: what a user does in the running app and what they see, concrete enough to run with real data (inputs, expected output). A step the builder cannot execute and observe is not a step.
- Every feature with screens is marked `ui`.

## Output
Plan id: `YYYYMMDD-<short-slug>`. Work in the agent worktree. Write:
- `.slice/plans/<id>/spec.md`
- `.slice/plans/<id>/features.json`:
  ```json
  {"features": [{"id": "f1", "title": "...", "steps": ["User does X", "Sees Y"], "passes": false, "ui": true}]}
  ```
  Every `passes` is `false`; `ui` is optional. Only `passes` may change after this skill.
- `.slice/plans/<id>/state.json`: `{"state": "parked", "builderModel": "<model>"}` with `<model>` `sonnet` when you
  used quick mode (a small change in one place) and `opus` for anything bigger. For a large plan add
  `"builderAdvisor": "opus"`: deep mode and at least one of a new app, an architecture decision in `## Decisions`, or 8
  or more features. The marker's `builderModel` and `builderAdvisor` override both. When the plan builds on others that
  are not `done`, add `"dependsOn": ["<plan id>", ...]`; omit the key otherwise.

Commit them in the agent worktree as `slice: plan <id>`, and push the agent branch when the repo has a remote (never
force). Then ask one AskUserQuestion, the start question: `Start now` (recommended), `Start in the cloud` (only when the repo has a GitHub remote), `Park`, `Plan another task`.
- Start now: invoke the `run` skill for the plan (it refuses and names the plan it waits for when `dependsOn` is open).
- Start in the cloud: invoke the `run` skill for the plan as a cloud start.
- Park: the plan stays `parked`; say how to start it later ("start plan <id>") and that a check-in routine picks parked plans up on its own once the plans in `dependsOn` are `done`.
- Plan another task: begin a new interview.
