---
name: shape
description: Plans a piece of work as a product spec and a feature list with executable end-to-end steps, after an interview, and writes it as GitHub issues (epic with sub-issues, or one ticket) or as .slice files. Use when the person wants to plan a ticket, feature, app, epic or milestone before an unattended /slice:run.
when_to_use: /slice:shape, "plan this", "write a spec", "break this into features", "create issues for this", "Feature planen", "Spezifikation schreiben", "Arbeit in Features aufteilen", "Epic anlegen", "vor dem Run".
disable-model-invocation: true
---
Plan the work with the person. Read the repo first (README, docs, existing code, `.slice/` if present). The result is
either GitHub issues or the two files `.slice/spec.md` and `.slice/features.json`; nothing else is written.

## Mode
- Quick: at most 6 questions. For a ticket.
- Deep: no question limit. For an epic or a milestone.

Suggest the mode by the size of the work; the person can override. Deep mode ends only when all three hold: no open
clarification point remains, every feature has executable E2E steps, and the person confirmed a short summary of
the plan.

## Interview
Never ask what the repo already answers. Ask what changes the plan: who uses it, how they notice it works, scope
edges, data, hard constraints. Where the options are clear, use AskUserQuestion, one question each, your recommended
option first. Ask open questions for the goal, the users and what "good" means. If AskUserQuestion is unavailable,
ask in plain text and end the turn. Say plainly when the person's idea has a weaker approach and why.

## Existing code (brownfield)
Before the interview run the built-in `Explore` subagent on the affected area: modules, existing patterns, entry
points, risks. Its short summary goes into the epic under `## Context`.

## No app yet (greenfield)
The first feature is always a walking skeleton: the app starts, the core path runs thinly end to end, and the verify
recipe gets recorded (`/run-skill-generator`). Its steps say so.

## Scope
Be ambitious. Plan the complete product the person describes, not a minimal first cut. Skip nothing a user would expect, and add what would make it clearly better than the obvious version.

## Spec
Product level only: purpose, users, what they can do, the quality bar. No implementation details, no file names, no stack unless the person fixed one. For screens, add the states that must exist (empty, loading, error, long data).

## Features
- Order so each feature can be built and checked after the ones before it; the first feature runs the core path end to end, thinly.
- Steps: what a user does in the running app and what they see, concrete enough to run with real data (inputs, expected output). A step the builder cannot execute and observe is not a step.
- Every feature with screens is marked `ui`.

## Output
Ask once whether to create GitHub issues (recommended yes), only if the repo has a GitHub remote and `gh auth status`
works. Use REST through `gh api` only, never `gh issue` (GraphQL fails in cloud sessions).

Issue formats, the same ones `/slice:run` reads:
- Epic: one parent issue, label `slice`. Body sections `## Spec` (the product-level spec) and optional `## Context`
  (the exploration summary). Its sub-issues are the features, in build order.
- Feature or ticket: one issue, label `slice` (plus `ui` for features with screens). Body section `## E2E steps` as
  a `- ` list, one line per step; optional `## Notes`.
- Milestone: a GitHub milestone holding epics and/or tickets.

Create what is missing, with `gh api repos/<o>/<r>/...`:
1. Labels `slice` and `ui` (`POST labels`, skip if `GET labels/<name>` succeeds).
2. Optional milestone (`POST milestones -f title=...`), set on the issues with `-F milestone=<number>`.
3. Epic: `POST issues`, then each feature in build order with `POST issues`. Link every feature with
   `POST issues/<epic>/sub_issues -F sub_issue_id=<id>`; `<id>` is the feature's numeric `id` from the create
   response, not its number.
4. A single ticket is one issue with `## E2E steps`, no epic.

Show the issue numbers and titles in order, and say: review them, then `/slice:run #<epic>` (or `milestone:<n>`).

Without issues, write `.slice/spec.md` and `.slice/features.json`:
```json
{"features": [{"id": "f1", "title": "...", "steps": ["User does X", "Sees Y"], "passes": false, "ui": true}]}
```
Every `passes` is `false`; `ui` is optional. Only `passes` may change after this skill. Show the feature titles in
order and say: review both files, then `/slice:run`.
