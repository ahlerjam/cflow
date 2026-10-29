---
name: verify
description: Verifies a change before it is committed in this repo, by asking slice for the proof and observing the running app. Use before every commit and whenever asked to verify a change.
---
Do both parts. Report what you saw, not what you expect.

1. Proof. Call the slice tool with `action: prove` (no `cmd` runs `make verify`). A hit "cached from <time>" on this tree is enough; do not run the suite again. Without the slice plugin, run `make verify` yourself. If it fails, fix the cause and prove again.
2. Look. When the change touches UI or runtime behaviour, start the app by the project's /run recipe (see `.claude/skills/run-*/`), use the changed path the way a person would, and report what was visible: states, texts, errors in the console. For other changes say "no runtime change".

Do not claim success from your own test run. Commit only after part 1 passed on the current tree.
