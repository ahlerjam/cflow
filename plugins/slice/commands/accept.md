---
description: "Builds the acceptance page of a finished run from the harness's report and records the person's accept or reject per slice."
allowed-tools: Read, Bash, AskUserQuestion, Skill, mcp__slice__slice
disable-model-invocation: true
argument-hint: "[<slice> reject \"<why>\"]"
---
Acceptance runs in the person's interactive session, never in a run session.

With arguments `<slice> reject "<why>"`: call the slice tool with action `accept`, `id` the slice, verdict `reject`, text the reason, report its answer, and stop.

Otherwise:
1. Call the slice tool with action `report`; the run worktree is `run.wt` in its JSON. Then call action `prove` with `all: true` and `cwd` that worktree. Anything but "all N proofs green" goes to the top of the page as the result.
2. Build one page from the report's JSON. Top: the result, "all N proofs green on <sha>". Then three sections: "Waiting for me" (stuck slices with their question, asks refused during the run, UX assumptions with screenshots, the sampled low slice), "Changed" (per slice: claim, proof end, proof amends, `diskMb` and `used` (7-day percent), better ideas), "Found" (each slice's `found`: defects the verifier caught). Each slice row has a "Copy as prompt" button holding `/slice:accept <slice> reject "…"`. At the end suggest `/simplify` and, with high slices and an origin, `/security-review`; you do not run them.
3. Publish it as a private Artifact with the Artifact tool (load an artifact design skill first if one is available). Without the Artifact tool, write the page under `.git/slice/pages/` and give the person its path.
4. Ask the person per slice with AskUserQuestion, the sampled low slice first and in full: accept, or reject with a reason. Record each answer with the slice tool: action `accept` with `id`, `verdict` accept or reject, and `text` for a reject. A reject queues a fix slice, a miss and a calibration example for the verifier; then `/slice:run` continues.
5. When every slice is accepted, say how to merge the run branch: the person merges, never you.
