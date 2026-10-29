---
name: slice
description: Sizes a piece of work as throwaway, ticket or feature, sets its risk level from the diff, writes the claim as checkable points and ends the work with the slice tool, which runs the proof itself. Use when starting or finishing a change in a repo that has .claude/slice.json.
when_to_use: Fix, implement, build a feature, "ultracode", before a commit or PR, "ist das fertig", "Ticket", "Feature bauen", "Freigabe prüfen".
---
Active only when `.claude/slice.json` exists in the repo. Otherwise ignore this skill.

## Say the size in one line first
`<size> · <risk> · proof: <command>`, for example `ticket · low · proof: make verify-export FILE=fixtures/umlauts.tex`. The person overrides size or risk with one word.
- throwaway: a prototype. Only the lock applies; skip everything below.
- ticket: small, clear, one place. Work in this session, no subagent, no file.
- feature: several files, UI, data or core paths. Use `/slice:feature`, also when the person types "ultracode" or asks for a workflow.

## Risk comes from the diff, not the path
- low: text, styles, additive, under about 50 lines.
- medium: logic in core paths (`coreCmds` and paths in `.claude/slice.json`). `done` refuses once with "run /code-review high, or say skip"; a word from the person is enough.
- high: data migration, auth, paths that had a `/slice-miss` in the last 30 days. The verifier runs on Opus; add security points to the claim.

## The claim
Write results as checkable points, each with a command and what it proves. Numbers and references, not adjectives. A feature claim has two parts: proof points (binary: states empty, loading, error, long data; keyboard and a11y minimum; one real document or payload) and a quality brief with references, anti-patterns and the question "what would the impressive version look like". Ask only what the code, NORTHSTAR.md, DESIGN.md or ADRs do not already answer.

## The mod proves, you do not
Never report a proof as passed from your own run. Call the slice tool:
- `prove` runs the allowed command under the machine lock and answers from cache on an unchanged tree. It rejects TODOs, stubs, placeholder text, tests without a value assertion and new Markdown files; fix the cause.
- `note` with `cmd` and `files` freezes a proof; later edits to those files need the person. Without `cmd` it logs a decision.
- `done` closes the slice. It refuses without a passed proof on the current tree.
Run only the affected tests while editing: `make test-affected FILES=…`. If `/simplify` changes code, prove again.

## Scope contract
Do what was asked. Everything else becomes a suggestion in your report, not code: no extra tests, hooks, guards, ADRs, plan or notes files, no refactors of code you did not touch. Do not fix other agents' fixes. In repos with other committers follow their PR convention and leave slice vocabulary out.

## Habits
- Tests: about one per behaviour. The end-to-end run with real data is the main evidence; green unit tests are a hint.
- Comments only for a non-obvious why. No error handling without a reason, no abstraction for a single use.
- Debugging: reproduce first, then find the cause, then fix. After two failed attempts rethink the approach.
- Decisions the person owns: direction, tech stack, architecture, UX. Suggest, never decide them silently.
- Text for German UI follows the project's language rules; no dashes as punctuation in German text.

## Report
Result first. Then: which proofs the mod ran, what you added beyond the claim and what you discarded (each with a reason), what could not run on real data, and one better idea if you have one.
