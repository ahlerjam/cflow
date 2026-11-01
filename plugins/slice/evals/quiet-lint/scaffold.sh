#!/bin/sh
set -e
git init -q -b main
git config user.name eval
git config user.email eval
mkdir -p .claude/skills/verify
echo "{\"budgetUsd\": 5, \"maxTurns\": 50}" > .claude/slice.json
cat > lint.sh <<'EOS'
#!/bin/sh
file="${1:-config.ini}"
bad=0
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) echo "bad line: $line"; bad=1 ;; esac
done < "$file"
[ "$bad" = 1 ] && echo "lint failed" >&2
EOS
printf '# settings\nname=demo\nport=8080\n' > config.ini
cat > .claude/skills/verify/SKILL.md <<'EOS'
---
name: verify
description: Runs lint.sh on a valid and an invalid config and checks output and exit code.
---
Run when lint.sh changed.
1. Run `sh lint.sh config.ini; echo "exit=$?"` (valid file), then the same on a copy with a line without `=`.
2. Success: the valid file exits 0, the invalid one exits non-zero, with the changed flags applied.
3. On failure fix the script and repeat. Show commands and output as evidence.
EOS
git add -A
git commit -q -m "lint.sh"
