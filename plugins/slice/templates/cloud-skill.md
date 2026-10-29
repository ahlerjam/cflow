---
name: slice-cloud
description: Runs an approved slice stage inside a Claude Code cloud session, where plugins do not load, by dispatching it to a nested Claude Code that loads slice from .slice/plugin. Use when the person asks in a cloud session to run, continue or check a slice stage.
---
You only dispatch. You do not edit product code yourself.

1. Find the stage: `git ls-remote origin 'refs/slice/*-queue'`. With more than one, ask which; with none, say the queue must be approved locally with /slice:shape first.
2. Load it: `git fetch origin refs/slice/<stage>-queue && mkdir -p "$(git rev-parse --git-common-dir)/slice" && git show FETCH_HEAD:state.json > "$(git rev-parse --git-common-dir)/slice/state.json"`, then `git fetch origin slice/<stage> && git checkout -B slice/<stage> origin/slice/<stage>`.
3. Run, with the prompt on stdin: `SLICE_RUN=1 SLICE_CLOUD=1 claude -p --plugin-dir .slice/plugin --settings .slice/plugin/profiles/cloud.json --permission-mode dontAsk`. Prompt: "Call the slice tool with action start and text cloud. It answers with the next slice to build; follow it, and after each merge follow the next instruction it gives, until it answers run finished or halted. Print its last answer."
4. Push the result: `git push origin slice/<stage>`. The mod pushed the status to `refs/slice/<stage>-status` itself.
5. Send one PushNotification with the stage and the last answer, at most 150 characters.

If step 3 prints that the hooks module did not load, run it once more; if it fails again, report the message and stop.
