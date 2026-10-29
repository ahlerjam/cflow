// The lock is a symlink to the holder's pid: ln -s is atomic, so a lock never exists without its pid.
// A dead holder is removed under a second symlink, so two stealers never delete a fresh lock.
const SCRIPT = String.raw`d=/tmp/slice-lock-$(id -u).l; w=$d.want; i=$SLICE_I; n=$SLICE_N; own=0; st=0; start=$(date +%s)
cleanup() { [ $own = 1 ] && rm -f "$d"; [ $st = 1 ] && rm -f "$d.steal"; rm -f "$w.$$"; }
trap cleanup EXIT; trap 'exit 143' INT TERM HUP
[ $i = 1 ] && : > "$w.$$"
wanted() { for f in "$w".*; do [ -e "$f" ] || continue; kill -0 "$(echo "$f" | sed 's/.*\.//')" 2>/dev/null && return 0; rm -f "$f"; done; return 1; }
while :; do
  if [ $i = 1 ] || ! wanted; then
    if ln -sn $$ "$d" 2>/dev/null; then own=1; break; fi
    h=$(readlink "$d" 2>/dev/null)
    if [ -n "$h" ] && ! kill -0 "$h" 2>/dev/null; then
      if ln -sn $$ "$d.steal" 2>/dev/null; then
        st=1; [ "$(readlink "$d")" = "$h" ] && rm -f "$d"; rm -f "$d.steal"; st=0; continue
      fi
      x=$(readlink "$d.steal" 2>/dev/null); [ -n "$x" ] && ! kill -0 "$x" 2>/dev/null && rm -f "$d.steal"
    fi
  fi
  if [ $(( $(date +%s) - start )) -ge $n ]; then
    [ -n "$h" ] || h=unknown
    echo "slice-lock: waited $n s for $d (holder pid: $h). Fix: wait until that process ends, or rerun with a longer wait." >&2
    exit 3
  fi
  sleep 1
done
rm -f "$w.$$"
SLICE_LOCK_HELD=1 "$@"`

export function lockArgv(argv: string[], opts: { interactive: boolean; waitSec?: number }): string[] {
  const secs = Math.floor(opts.waitSec ?? NaN)
  const wait = Number.isFinite(secs) && secs > 0 ? secs : 90
  const script = SCRIPT.replace('$SLICE_I', opts.interactive ? '1' : '0').replace('$SLICE_N', String(wait))
  return ['sh', '-c', script, 'slice-lock', ...argv]
}
