#!/bin/sh
# Runs a slice plan inside a cloud session (Linux, cwd = the repo clone). Called by the launcher task.
# usage: cloud-run.sh start <id> <agentBranch>
#        cloud-run.sh wait <id> <agentBranch> [seconds=540]
# start: fetches the agent branch, starts a detached supervisor; prints started, already running or FAILED: ...
# wait: prints DONE: ... or FAILED: ... once the plan ended, else running: <log tail> after <seconds>.
# The supervisor runs the orchestrator (claude -p 'start plan <id>') up to 3 times and writes /tmp/slice-<id>-result.
# Test overrides: SLICE_ORCH_CMD (shell string replacing the claude call; gets SLICE_PLAN_ID and
# SLICE_AGENT_BRANCH), SLICE_RETRY_S (pause between attempts, default 30), SLICE_WAIT_POLL_S (default 5).

if [ $# -lt 3 ]; then
  sed -n '2,8p' "$0" >&2
  exit 2
fi
cmd=$1 id=$2 br=$3
SELF=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")
PLUGIN=$(cd "$(dirname "$0")/.." && pwd)
LIVE="$PLUGIN/scripts/live.sh"
T=/tmp/slice-$id
PIDF=$T-supervisor.pid
RES=$T-result
LOG=$T-orch.jsonl
RESTARTS=$T-restarts

fetch_branch() {
  FETCH_ERR=$(git fetch origin "+refs/heads/$br:refs/remotes/origin/$br" 2>&1)
}

alive() {
  [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null
}

start_cmd() {
  if ! fetch_branch; then
    git ls-remote --exit-code --heads origin "$br" >/dev/null 2>&1
    if [ $? -eq 2 ]; then
      echo "FAILED: agent branch $br is not on origin"
    else
      echo "FAILED: cannot fetch $br: $(printf '%s' "$FETCH_ERR" | tr '\n' ' ')"
    fi
    return 0
  fi
  if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
    git fetch --unshallow origin >/dev/null 2>&1
  fi
  if ! git rev-parse -q --verify "refs/heads/$br" >/dev/null 2>&1; then
    git branch "$br" "origin/$br" >/dev/null 2>&1
  fi
  if ! git show "origin/$br:.slice/plans/$id/state.json" >/dev/null 2>&1; then
    echo "FAILED: plan $id is not on origin/$br"
    return 0
  fi
  if alive; then
    echo "already running"
    return 0
  fi
  rm -f "$PIDF" "$RES"
  [ "$1" = fresh ] && rm -f "$RESTARTS"
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid sh "$SELF" supervise "$id" "$br" >"$T-supervisor.log" 2>&1 &
  else
    nohup sh "$SELF" supervise "$id" "$br" >"$T-supervisor.log" 2>&1 &
  fi
  n=0
  while [ ! -s "$PIDF" ] && [ $n -lt 5 ]; do sleep 1; n=$((n + 1)); done
  echo started
}

plan_state() {
  fetch_branch >/dev/null 2>&1
  git show "origin/$br:.slice/plans/$id/state.json" 2>/dev/null \
    | grep -o '"state"[[:space:]]*:[[:space:]]*"[a-z]*"' | head -1 | sed 's/.*"\([a-z]*\)"$/\1/'
}

live_line() {
  sh "$LIVE" status . "$id" 2>/dev/null
}

run_orch() {
  if [ -n "$SLICE_ORCH_CMD" ]; then
    SLICE_PLAN_ID=$id SLICE_AGENT_BRANCH=$br sh -c "$SLICE_ORCH_CMD" >> "$LOG" 2>&1
  else
    SLICE_PLUGIN_DIR="$PLUGIN" claude -p --plugin-dir "$PLUGIN" "start plan $id" --model sonnet \
      --permission-mode dontAsk --allowedTools 'Bash,Read,Edit,Write,Glob,Grep,Skill' \
      --output-format stream-json --verbose >> "$LOG" 2>&1
  fi
}

# Ends the live ref only while the claim this supervisor's orchestrator made still holds it.
release() {
  if [ -n "$own" ]; then
    set -- "$1" $(live_line)
    if [ "$2" = live ] && [ "$3" = "$own" ]; then
      sh "$LIVE" end . "$id" launcher "$1" >/dev/null 2>&1
    fi
  fi
  own=
}

supervise() {
  echo $$ > "$PIDF"
  RETRY=${SLICE_RETRY_S:-30}
  own=
  attempt=1
  while [ $attempt -le 3 ]; do
    before=$(live_line)
    run_orch
    st=$(plan_state)
    case $st in
      done|partial|halted)
        printf 'DONE: plan %s %s\n' "$id" "$st" > "$RES"
        exit 0 ;;
    esac
    after=$(live_line)
    case $after in
      "live "*)
        o=${after#live }; o=${o%% *}
        case $before in "live $o "*) ;; *) own=$o ;; esac ;;
    esac
    attempt=$((attempt + 1))
    if [ $attempt -le 3 ]; then
      release interrupted
      sleep "$RETRY"
    fi
  done
  release failed
  printf 'FAILED: plan %s is still %s after 3 orchestrator runs (see %s)\n' "$id" "${st:-unreadable}" "$LOG" > "$RES"
}

wait_cmd() {
  secs=${1:-540}
  deadline=$(( $(date +%s) + secs ))
  restarted=0
  while :; do
    [ -f "$RES" ] && { cat "$RES"; return 0; }
    if ! alive; then
      [ -f "$RES" ] && { cat "$RES"; return 0; }
      if [ $restarted = 0 ]; then
        restarted=1
        n=$(cat "$RESTARTS" 2>/dev/null || echo 0)
        if [ "$n" -ge 3 ]; then
          echo "FAILED: supervisor died 3 times" > "$RES"
          cat "$RES"
          return 0
        fi
        echo $((n + 1)) > "$RESTARTS"
        out=$(start_cmd)
        case $out in
          FAILED*) echo "$out" > "$RES"; echo "$out"; return 0 ;;
        esac
      fi
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "running: $(tail -n 1 "$LOG" 2>/dev/null | tail -c 300 | tr '\n\r' '  ')"
      return 0
    fi
    sleep "${SLICE_WAIT_POLL_S:-5}"
  done
}

case $cmd in
  start) start_cmd fresh ;;
  supervise) supervise ;;
  wait) wait_cmd "$4" ;;
  *) sed -n '2,8p' "$0" >&2; exit 2 ;;
esac
