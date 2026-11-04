#!/bin/sh
# SessionStart: tell the session that slice is active. Silent without the marker and in run sessions.
[ "$SLICE_RUN" = 1 ] && exit 0
[ -f "${CLAUDE_PROJECT_DIR:-.}/.claude/slice.json" ] || exit 0
text='slice is active in this repo. '
text="$text"'Requests to build or change something go through the `shape` skill '
text="$text"'(size estimate, interview, summary, start question) and, only after the person picks Start now, '
text="$text"'the `run` skill. '
text="$text"'Never edit code on the current branch for such requests; slice works in its own worktrees and branches. '
text="$text"'\"show my plans\", \"start plan <id>\", \"plan decision D<n>: <instructions>\", \"stop the run\" and '
text="$text"'\"how far is the run?\", \"check my plans\" map to the `run` skill. '
text="$text"'Small questions about the code are answered normally. '
text="$text"'Set up slice (the `setup` skill) only when asked.'
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$text"
