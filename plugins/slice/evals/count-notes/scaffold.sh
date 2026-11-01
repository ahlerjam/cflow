#!/bin/sh
set -e
git init -q -b main
git config user.name eval
git config user.email eval
mkdir -p .claude/skills/verify
echo "{\"budgetUsd\": 5, \"maxTurns\": 50}" > .claude/slice.json
cat > notes.sh <<'EOS'
#!/bin/sh
f="${NOTES_FILE:-notes.txt}"
case "$1" in
  add) shift; printf '%s\n' "$*" >> "$f" ;;
  list) cat -n "$f" ;;
  *) echo "usage: notes.sh add|list" >&2; exit 2 ;;
esac
EOS
printf 'buy milk\ncall anna\nwrite report' > notes.txt
cat > .claude/skills/verify/SKILL.md <<'EOS'
---
name: verify
description: Runs notes.sh against the committed notes.txt and checks the output.
---
Run when a command of notes.sh changed.
1. From the repo root run `sh notes.sh list` and `sh notes.sh <changed command>` on the committed notes.txt (3 notes).
2. Success: the output matches the 3 notes in notes.txt exactly and the exit code is 0 (`echo $?`).
3. On failure fix the script and repeat. Show commands and output as evidence.
EOS
git add -A
git commit -q -m "notes.sh with add and list"
