---
name: shape
description: Turns an idea or a stage into an approved slice queue with the person, about 20 minutes, ending in one approval of queue and permission scope by the slice tool. Use when the person runs /slice:shape before an unattended /slice:run.
disable-model-invocation: true
---
Shape one stage with the person. Without `.claude/slice.json` tell the person to run /slice:setup and stop. Write no plan, spec or notes file: the queue lives in the slice tool, the rest stays in this conversation.

## Interview
At most 6 questions, one per AskUserQuestion, each with your recommended answer first. Never ask what the code, `NORTHSTAR.md`, `DESIGN.md` or the ADRs already answer; read them first.
1. The value question: "How do you notice it works?" The answer becomes the stage scenario, a path a person walks end to end.
2. Offer 2 to 3 approaches with their failure modes. Say so plainly when the person's idea is the weaker one and why.
3. Ask only what changes the queue: scope edges, data, who uses it.

## What you hand over before the queue
- A parity table against one real product the person names or accepts: a row per capability, the person strikes rows.
- Every screen and its states (empty, loading, error, long data). For screens follow the `taste` skill: the chosen mockup per screen family (taste: 3 to 6 options, the person picks one), tokens from `DESIGN.md`.
- A dependency allowlist: maintained packages, MIT or Apache, nothing else gets added during the run.
- The field "ten times better": one line on what would make this stage clearly better than the reference, not just equal.

## The queue
6 to 15 slices. Order: bug, infra, tracer, feature, then the two standing slices polish and consolidate. The tracer slice makes the stage scenario run end to end from slice 1, thinly.
Each slice: `id`, `kind`, `claim` as checkable points (proof points plus the quality brief's references and anti-patterns), `brief`, `proof` (a make target, default `make verify`; a `verify-*` per scenario is better), `risk`, `after` (ids it needs), `ui` for screens.
- polish: at most 3 rounds of fixes found on screens and texts.
- consolidate: rebuild the weakest fix with what the stage taught; it suggests `/simplify` and, with high slices and an origin, `/security-review` to the person.
Stage budget: percent of the weekly limit the stage may use (default 30); `maxHours` wall clock (default 48).

## Two final checks, out loud
1. Every point of the stage scenario belongs to a slice.
2. Someone who never saw this chat can build each slice from its brief alone.

## Approval
Call the slice tool with action `queue` and `stage`: `{stage, budget, maxHours, slices}`. The mod asks the person in its own dialog to approve the queue and the permission scope; your words do not count. Rejected: change what the person says and queue again. Approved: tell the person to start with `/slice:run`.
