---
description: "Starts the approved slice queue as an unattended run: one background session per slice, the mod proves, merges and starts the next."
allowed-tools: AskUserQuestion, mcp__slice__slice
disable-model-invocation: true
---
Start the run of this repo's approved queue.

1. Ask one AskUserQuestion: "Will this Mac stay online and awake until you accept the stage?" Options: "Yes, run here (Recommended)", "No, I close it". With No, slices without UI and heavy local load go to the cloud when the repo opted in (`"cloud": true` in `.claude/slice.json`); say which ones.
2. Call the slice tool with action `start` and text `online` or `offline`.
3. Report what the tool answered: the first slice started, or why it queued or halted. Name how to follow: `/slice-status`, `claude agents`, `/slice-pause`, `/slice-resume`, `/slice-stop`. Each halt and the end of the run send a push to the person's phone.

Never type into a run session yourself and never commit, push or merge for the run; the mod does that.
