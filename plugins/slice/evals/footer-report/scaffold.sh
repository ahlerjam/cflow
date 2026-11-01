#!/bin/sh
set -e
git init -q -b main
git config user.name eval
git config user.email eval
mkdir -p .claude/skills/verify
echo "{\"budgetUsd\": 5, \"maxTurns\": 50}" > .claude/slice.json
mkdir -p bin templates
cat > bin/report.sh <<'EOS'
#!/bin/sh
cat templates/header.txt
EOS
echo "== Weekly report ==" > templates/header.txt
echo "-- end of report --" > templates/footer.txt
cat > .claude/skills/verify/SKILL.md <<'EOS'
---
name: verify
description: Runs bin/report.sh from the repo root and from other directories.
---
Run when bin/report.sh or a template changed.
1. Run `sh bin/report.sh <options>` from the repo root, then `cd bin && sh report.sh <options>`.
2. Success: both runs print the same expected text and exit 0. A run that prints an error or differs is a failure.
3. On failure fix the script and repeat. Show commands and output as evidence.
EOS
git add -A
git commit -q -m "report.sh with header"
