#!/bin/sh
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -f "$root/.claude/slice.json" ] || exit 0
cat <<'MSG'
This repo uses slice. For any code change: before committing, run the verify recipe
(.claude/skills/verify/SKILL.md, the `verify` skill) against the running program, compare its output
with what the task expects, show command and output as evidence, and commit only after it passes.
Bigger work: /slice:shape, then /slice:run.
MSG
