#!/bin/sh
# Usage: issues-to-files.sh <owner/repo> <issue-number> | milestone:<number>
# Writes .slice/spec.md and .slice/features.json in the current directory from GitHub issues (REST only).
# SLICE_INCLUDE_CLOSED=1 also takes closed issues; for testing against finished fixtures.
set -eu

die() { echo "issues-to-files: $*" >&2; exit 1; }
[ $# -eq 2 ] || die "usage: issues-to-files.sh <owner/repo> <issue-number> | milestone:<number>"
repo=$1
src=$2
closed_ok=${SLICE_INCLUDE_CLOSED:-0}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
: >"$tmp/spec"
: >"$tmp/features"
: >"$tmp/seen"
k=0

issue() { gh api "repos/$repo/issues/$1" --jq "$2"; }

body() { issue "$1" '(.body // "") | gsub("\r";"")'; }

sub_count() {
  c=$(issue "$1" '.sub_issues_summary.total // 0') && [ -n "$c" ] || die "cannot read issue #$1 of $repo"
  echo "$c"
}

# Sub-issue numbers in build order. GitHub returns them in the epic's order.
subs() {
  sel='.[]'
  [ "$closed_ok" = 1 ] || sel='.[] | select(.state == "open")'
  gh api --paginate "repos/$repo/issues/$1/sub_issues?per_page=100" --jq "$sel | .number"
}

# Steps are the "- " items under "## E2E steps", text copied verbatim.
add_feature() {
  grep -qx "$1" "$tmp/seen" && return 0
  echo "$1" >>"$tmp/seen"
  k=$((k + 1))
  # shellcheck disable=SC2016
  obj=$(issue "$1" '
    ((.body // "") | split("\n") | map(sub("\r$";""))
      | reduce .[] as $l ({sec: false, s: []};
          if ($l | test("^## ")) then .sec = ($l | test("^## E2E steps\\s*$"))
          elif (.sec and ($l | test("^- \\S"))) then .s += [$l[2:]]
          else . end)
      | .s) as $s
    | "{\"id\":\"f'"$k"'\",\"issue\":" + (.number | tostring)
      + ",\"title\":" + (.title | tojson)
      + ",\"steps\":" + ($s | tojson)
      + ",\"passes\":false,\"ui\":" + ((([.labels[].name] | index("ui")) != null) | tostring) + "}"')
  [ -n "$obj" ] || die "cannot read issue #$1 of $repo"
  case $obj in
    *'"steps":[]'*) die "feature #$1 has no items under '## E2E steps'; run /slice:shape for that issue" ;;
  esac
  echo "$obj" >>"$tmp/features"
}

# Adds an epic's open sub-issues as features; returns 1 if there are none.
add_epic_features() {
  before=$k
  for s in $(subs "$1"); do add_feature "$s"; done
  [ "$k" -gt "$before" ]
}

case $src in
  milestone:*)
    m=${src#milestone:}
    state=open
    [ "$closed_ok" = 1 ] && state=all
    list=$(gh api --paginate "repos/$repo/issues?milestone=$m&state=$state&per_page=100" \
      --jq '.[] | select(.pull_request | not) | .number' | sort -n)
    [ -n "$list" ] || die "milestone $m has no issues"
    : >"$tmp/covered"
    for n in $list; do
      if [ "$(sub_count "$n")" -gt 0 ]; then subs "$n" >>"$tmp/covered"; fi
    done
    for n in $list; do
      grep -qx "$n" "$tmp/covered" && continue
      title=$(issue "$n" '.title')
      if [ "$(sub_count "$n")" -gt 0 ]; then
        if ! add_epic_features "$n"; then
          echo "issues-to-files: epic #$n has no open sub-issues, skipped" >&2
          continue
        fi
      else
        add_feature "$n"
      fi
      { printf '## #%s %s\n\n' "$n" "$title"; body "$n"; echo; } >>"$tmp/spec"
    done
    ;;
  *)
    n=$src
    if [ "$(sub_count "$n")" -gt 0 ]; then
      { printf '# %s\n\n' "$(issue "$n" '.title')"; body "$n"; } >"$tmp/spec"
      add_epic_features "$n" || die "epic #$n has no open sub-issues"
    else
      body "$n" >"$tmp/spec"
      add_feature "$n"
    fi
    ;;
esac

[ "$k" -gt 0 ] || die "no features found in $src"

mkdir -p .slice
cp "$tmp/spec" .slice/spec.md
printf '{"features":[%s]}\n' "$(paste -sd, "$tmp/features")" >.slice/features.json
echo "wrote .slice/spec.md and .slice/features.json ($k features)"
