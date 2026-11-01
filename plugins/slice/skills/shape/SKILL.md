---
name: shape
description: Plans a bigger piece of work as a product spec and a feature list with end-to-end steps, after a short interview, and optionally creates one GitHub issue per feature. Use when the person wants to plan a feature, app or stage before an unattended /slice:run.
when_to_use: /slice:shape, "plan this", "write a spec", "break this into features", "Feature planen", "Spezifikation schreiben", "Arbeit in Features aufteilen", "vor dem Run".
disable-model-invocation: true
---
Plan the work with the person. Read the repo first (README, docs, existing code, `.slice/` if present). Write exactly two files, `.slice/spec.md` and `.slice/features.json`, plus optional GitHub issues. No other files.

## Interview
At most 6 questions, one per AskUserQuestion, your recommended answer first. Never ask what the repo already answers. Ask what changes the plan: who uses it, how they notice it works, scope edges, data, hard constraints. Say plainly when the person's idea has a weaker approach and why.

## Scope
Be ambitious. Plan the complete product the person describes, not a minimal first cut. Skip nothing a user would expect, and add what would make it clearly better than the obvious version.

## `.slice/spec.md`
Product level only: purpose, users, what they can do, the quality bar. No implementation details, no file names, no stack unless the person fixed one. For screens, add the states that must exist (empty, loading, error, long data).

## `.slice/features.json`
```json
{"features": [{"id": "f1", "title": "...", "steps": ["User does X", "Sees Y"], "passes": false, "ui": true, "issue": 12}]}
```
- Order so each feature can be built and checked after the ones before it; the first feature runs the core path end to end, thinly.
- `steps`: what a user does in the running app and what they see, concrete enough to run with real data (inputs, expected output). A step the builder cannot execute and observe is not a step.
- Every `passes` is `false`. `ui: true` on features with screens. `ui` and `issue` are optional.
- Only `passes` may change after this skill; the run guard blocks every other change.

## GitHub issues
Only if the person wants them and `gh auth status` works. One issue per feature, label `slice` (create it if missing), title = feature title, body = the steps. Store the number in `issue`.

## Finish
Show the feature titles in order. Tell the person to review the two files, then run /slice:run.
