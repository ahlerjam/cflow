#!/bin/sh
# Live ref of a slice plan: who runs it, heartbeat, stop signal, messages. Only git, pgrep, ps and coreutils.
# usage: live.sh status <dir> <id>
#        live.sh claim <dir> <id> <owner> <note>   beat <dir> <id> <owner> [inbox file]
#        live.sh stop <dir> <id> <reason>          tell <dir> <id> <text>
#        live.sh end <dir> <id> <owner> <state>    watch <dir> <id> <owner> <seconds> [push-run]
#        live.sh alive <dir> <id> <process>        kill <dir> <id> <process>
# State is the branch slice/live-<id> on origin: a chain of empty-tree commits (claim, beat, stop, end, msg).
# Pushes are plain, never forced; a rejected push is the lock. msg commits never change owner or age.
# A claim or beat older than SLICE_STALE_S seconds (default 900) is stale.
# Exit: 0 ok, 1 not running, 2 offline (stop, tell), 3 held by another owner, 4 stop requested, 5 run lost.
# watch looks for a process whose command line holds SLICE_WATCH_PROC (default <owner>); alive prints alive or
# gone for <process>, kill ends it. Other live.sh calls and the caller's own shells never count.
# Without an origin remote nothing is held: status prints none, stop and tell print not running.

STALE=${SLICE_STALE_S:-900}
POLL=${SLICE_POLL_S:-20}
BEAT=${SLICE_BEAT_S:-120}
RETRY=${SLICE_LIVE_RETRY_S:-5}
GIT_TERMINAL_PROMPT=0
# a hanging origin must not hang the run
GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=30
GIT_AUTHOR_NAME=slice GIT_AUTHOR_EMAIL=slice@localhost
GIT_COMMITTER_NAME=slice GIT_COMMITTER_EMAIL=slice@localhost
export GIT_HTTP_LOW_SPEED_LIMIT GIT_HTTP_LOW_SPEED_TIME
export GIT_TERMINAL_PROMPT GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL

if [ $# -lt 3 ]; then
  sed -n '2,13p' "$0" >&2
  exit 2
fi
cmd=$1 dir=$2 id=$3
shift 3
RB=refs/heads/slice/live-$id
LREF=refs/slice/live/$id

g() { git -C "$dir" "$@"; }
oneline() { printf '%s' "$1" | tr '\n\r' '  '; }
has_remote() { g config --get remote.origin.url >/dev/null 2>&1; }

# Sets TIP (empty when the ref does not exist). Returns 1 when origin cannot be reached.
read_tip() {
  TIP=
  if g fetch -q origin "+$RB:$LREF" >/dev/null 2>&1; then
    TIP=$(g rev-parse -q --verify "$LREF^{commit}")
    return 0
  fi
  g ls-remote --exit-code --heads origin "slice/live-$id" >/dev/null 2>&1
  if [ $? -eq 2 ]; then
    g update-ref -d "$LREF" >/dev/null 2>&1
    return 0
  fi
  return 1
}

# Judges TIP by its latest commit that is not a msg. Sets BASE, S_KIND, S_OWNER, S_REST, S_LINE.
describe() {
  BASE= S_KIND=none S_OWNER= S_REST= S_LINE=none
  [ -n "$TIP" ] || return 0
  BASE=$(g log --format='%H %s' "$TIP" | grep -v -m1 '^[0-9a-f]* msg$')
  BASE=${BASE%% *}
  [ -n "$BASE" ] || return 0
  subj=$(g log -1 --format=%s "$BASE")
  ct=$(g log -1 --format=%ct "$BASE")
  age=$(( $(date +%s) - ct ))
  kind=${subj%% *}
  case $subj in *' '*) S_REST=${subj#* } ;; esac
  case $kind in
    claim|beat)
      if [ "$kind" = claim ]; then S_OWNER=${S_REST%% *}; else S_OWNER=$S_REST; fi
      note=$(g log --format=%s "$BASE" | grep -m1 '^claim ')
      note=${note#claim }
      case $note in *' '*) note=${note#* } ;; *) note= ;; esac
      S_KIND=live
      [ "$age" -gt "$STALE" ] && S_KIND=stale
      S_LINE="$S_KIND $S_OWNER $age${note:+ $note}"
      ;;
    stop) S_KIND=stopping; S_LINE="stopping $age $S_REST" ;;
    end) S_KIND=ended; S_OWNER=${S_REST%% *}; S_LINE="ended $S_REST" ;;
  esac
}

# put <parent> <subject> [body]: commits and pushes. Returns 0 pushed, 1 rejected (TIP is
# re-read), 2 origin unreachable or the push failed for another reason.
put() {
  tree=$(g hash-object -w -t tree /dev/null) || return 2
  if [ -n "$3" ]; then body=$3; else body=; fi
  if [ -n "$1" ]; then
    if [ -n "$body" ]; then NEW=$(g -c commit.gpgsign=false commit-tree "$tree" -p "$1" -m "$2" -m "$body")
    else NEW=$(g -c commit.gpgsign=false commit-tree "$tree" -p "$1" -m "$2"); fi
  else
    if [ -n "$body" ]; then NEW=$(g -c commit.gpgsign=false commit-tree "$tree" -m "$2" -m "$body")
    else NEW=$(g -c commit.gpgsign=false commit-tree "$tree" -m "$2"); fi
  fi
  [ -n "$NEW" ] || return 2
  parent=$1
  if g push -q origin "$NEW:$RB" >/dev/null 2>&1; then
    g update-ref "$LREF" "$NEW" >/dev/null 2>&1
    return 0
  fi
  read_tip || return 2
  [ "$TIP" = "$NEW" ] && return 0
  [ "$TIP" = "$parent" ] && return 2
  return 1
}

# After describe: 4 with "stop <reason>", 5 with "lost <owner>", else 0.
guard() {
  case $S_KIND in
    stopping) printf 'stop %s\n' "$S_REST"; return 4 ;;
    live|stale|ended)
      if [ "$S_OWNER" != "$owner" ]; then printf 'lost %s\n' "$S_OWNER"; return 5; fi ;;
  esac
  return 0
}

# Appends the msg commits after BASE up to <tip> to the inbox file, oldest first.
deliver() {
  [ -n "$inbox" ] && [ -n "$BASE" ] || return 0
  shas=$(g rev-list --reverse "$BASE..$1")
  [ -n "$shas" ] || return 0
  if [ ! -f "$inbox" ]; then
    mkdir -p "$(dirname "$inbox")"
    ex=$(g rev-parse --git-path info/exclude)
    case $ex in /*) ;; *) ex=$dir/$ex ;; esac
    mkdir -p "$(dirname "$ex")"
    grep -qxF '.slice/plans/*/inbox.md' "$ex" 2>/dev/null || echo '.slice/plans/*/inbox.md' >> "$ex"
  fi
  for s in $shas; do
    ts=$(TZ=UTC g log -1 --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd "$s")
    text=$(g log -1 --format=%b "$s")
    printf '%s\n' "$text" | sed "1s/^/- [$ts] /;1!s/^/  /" >> "$inbox"
  done
}

beat_once() {
  has_remote || return 0
  read_tip || { echo offline; return 0; }
  describe
  guard || return $?
  [ "$S_KIND" = ended ] && return 0
  old=$TIP oldbase=$BASE
  put "$TIP" "beat $owner"
  case $? in
    0) BASE=$oldbase; deliver "$old"; return 0 ;;
    2) echo offline; return 0 ;;
  esac
  describe
  guard || return $?
  return 0
}

kill_pids() {
  pids=$(builder_pids)
  [ -n "$pids" ] || return 0
  kill $pids 2>/dev/null
  n=0
  while [ -n "$(builder_pids)" ] && [ $n -lt 15 ]; do sleep 1; n=$((n + 1)); done
  pids=$(builder_pids)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  return 0
}

set_anc() {
  anc=" "
  p=$$
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    anc="$anc$p "
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
}

# Pids whose command line names the process, minus this script, its ancestors and its descendants.
builder_pids() {
  pat=${SLICE_WATCH_PROC:-$owner}
  [ -n "$pat" ] || return 0
  for c in $(pgrep -f "$pat" 2>/dev/null); do
    case $anc in *" $c "*) continue ;; esac
    case $(ps -o args= -p "$c" 2>/dev/null) in *live.sh*) continue ;; esac
    p=$c
    rel=0
    while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
      if [ "$p" = "$$" ]; then rel=1; break; fi
      p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    done
    [ $rel = 0 ] && echo "$c"
  done
}

case $cmd in
  status)
    has_remote || { echo none; exit 0; }
    read_tip || { echo offline; exit 0; }
    describe
    printf '%s\n' "$S_LINE"
    ;;

  claim)
    owner=$1 note=$(oneline "$2")
    has_remote || { echo claimed; exit 0; }
    tries=0
    while :; do
      if ! read_tip; then
        tries=$((tries + 1))
        [ $tries -ge 3 ] && { echo "claimed offline"; exit 0; }
        sleep "$RETRY"
        continue
      fi
      describe
      prev=$S_LINE
      case $S_KIND in
        none) how=claimed; put "" "claim $owner $note" ;;
        live)
          [ "$S_OWNER" = "$owner" ] || { printf '%s\n' "$S_LINE"; exit 3; }
          how=claimed; put "$TIP" "beat $owner" ;;
        *) how="took over $prev"; put "$TIP" "claim $owner $note" ;;
      esac
      case $? in
        0) printf '%s\n' "$how"; exit 0 ;;
        1) continue ;;
      esac
      tries=$((tries + 1))
      [ $tries -ge 3 ] && { echo "claimed offline"; exit 0; }
      sleep "$RETRY"
    done
    ;;

  beat)
    owner=$1 inbox=$2
    beat_once
    exit $?
    ;;

  stop)
    reason=$(oneline "$1")
    has_remote || { echo "not running"; exit 1; }
    i=0
    while [ $i -lt 3 ]; do
      read_tip || { echo offline; exit 2; }
      describe
      case $S_KIND in
        none|ended) echo "not running"; exit 1 ;;
        stopping) echo "stop requested"; exit 0 ;;
      esac
      put "$TIP" "stop $reason"
      case $? in
        0) echo "stop requested"; exit 0 ;;
        2) echo offline; exit 2 ;;
      esac
      i=$((i + 1))
    done
    echo "stop not recorded"
    exit 2
    ;;

  tell)
    text=$1
    has_remote || { echo "not running"; exit 1; }
    i=0
    while [ $i -lt 3 ]; do
      read_tip || { echo offline; exit 2; }
      describe
      case $S_KIND in
        none|ended|stopping) echo "not running"; exit 1 ;;
      esac
      put "$TIP" msg "$text"
      case $? in
        0) echo delivered; exit 0 ;;
        2) echo offline; exit 2 ;;
      esac
      i=$((i + 1))
    done
    echo "message not recorded"
    exit 2
    ;;

  end)
    owner=$1 state=$2
    has_remote || exit 0
    i=0
    while [ $i -lt 3 ]; do
      if read_tip; then
        put "$TIP" "end $owner $state"
        [ $? -eq 0 ] && { echo ended; exit 0; }
      else
        sleep "$RETRY"
      fi
      i=$((i + 1))
    done
    exit 0
    ;;

  alive)
    owner=$1
    set_anc
    if [ -n "$(builder_pids)" ]; then echo alive; else echo gone; fi
    ;;

  kill)
    owner=$1
    set_anc
    kill_pids
    ;;

  watch)
    owner=$1 secs=$2 push=$3
    inbox=$dir/.slice/plans/$id/inbox.md
    set_anc
    start=$(date +%s)
    lastbeat=
    while :; do
      now=$(date +%s)
      [ -n "$(builder_pids)" ] || { echo exited; exit 0; }
      if [ -z "$lastbeat" ] || [ $((now - lastbeat)) -ge "$BEAT" ]; then
        lastbeat=$now
        out=$(beat_once)
        case $? in
          4) kill_pids; printf 'stopped %s\n' "${out#stop }"; exit 0 ;;
          5) kill_pids; printf '%s\n' "$out"; exit 0 ;;
        esac
        if [ "$push" = push-run ]; then
          g push -q origin "HEAD:refs/heads/slice/run-$id" >/dev/null 2>&1
        fi
      fi
      [ $((now - start)) -ge "$secs" ] && { echo running; exit 0; }
      sleep "$POLL"
    done
    ;;

  *)
    sed -n '2,13p' "$0" >&2
    exit 2
    ;;
esac
