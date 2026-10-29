#!/bin/sh
# Same lock and cache as the slice mod (mod/lock.ts), for make targets and the hook. Inactive in CI and without the marker.
top=$(git rev-parse --show-toplevel 2>/dev/null)
[ $# -eq 0 ] && { echo "Usage: slice-lock.sh <command...>" >&2; exit 2; }
{ [ -n "$CI" ] || [ -n "$SLICE_LOCK_HELD" ] || [ ! -f "$top/.claude/slice.json" ]; } && exec "$@"
dir=$(git rev-parse --path-format=absolute --git-common-dir)/slice; mkdir -p "$dir/cache"
x=$dir/idx.$$; tree=$(GIT_INDEX_FILE=$x git add -A 2>/dev/null && GIT_INDEX_FILE=$x git write-tree); rm -f "$x"
hit=$dir/cache/$tree-$(echo "$*" | sed 's/[^A-Za-z0-9_]\{1,\}/_/g')
[ -n "$tree" ] && [ -f "$hit" ] && { echo "slice-lock: cached pass for this tree, not running: $*"; exit 0; }
d=/tmp/slice-lock-$(id -u).l; w=$d.want; n=${SLICE_LOCK_WAIT:-90}; own=0; st=0; start=$(date +%s)
i=0; [ -z "$SLICE_RUN" ] && i=1
cleanup() { [ $own = 1 ] && rm -f "$d"; [ $st = 1 ] && rm -f "$d.steal"; rm -f "$w.$$"; }
trap cleanup EXIT; trap 'exit 143' INT TERM HUP
[ $i = 1 ] && : > "$w.$$"
wanted() { for f in "$w".*; do [ -e "$f" ] || continue; kill -0 "${f##*.}" 2>/dev/null && return 0; rm -f "$f"; done; return 1; }
while :; do
  if [ $i = 1 ] || ! wanted; then
    ln -sn $$ "$d" 2>/dev/null && { own=1; break; }
    h=$(readlink "$d" 2>/dev/null)
    if [ -n "$h" ] && ! kill -0 "$h" 2>/dev/null; then
      if ln -sn $$ "$d.steal" 2>/dev/null; then st=1; [ "$(readlink "$d")" = "$h" ] && rm -f "$d"; rm -f "$d.steal"; st=0; continue; fi
      x=$(readlink "$d.steal" 2>/dev/null); [ -n "$x" ] && ! kill -0 "$x" 2>/dev/null && rm -f "$d.steal"
    fi
  fi
  [ $(( $(date +%s) - start )) -ge $n ] && { echo "slice-lock: waited $n s for $d (holder pid: ${h:-unknown}). Fix: wait until that process ends, or set SLICE_LOCK_WAIT higher." >&2; exit 3; }
  sleep 1
done
rm -f "$w.$$"
"$@"; code=$?
[ $code = 0 ] && [ -n "$tree" ] && printf '{"t":"%s","cmd":"%s"}' "$(date -u +%FT%TZ)" "$(printf %s "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')" > "$hit.tmp" && mv "$hit.tmp" "$hit"
exit $code
