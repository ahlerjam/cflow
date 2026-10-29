export const meta = {
  name: 'feature',
  description: 'Supervised feature: builder in a worktree, proof run by the slice tool, fresh verifier, back to the builder up to 3 rounds',
  phases: [{ title: 'Build' }, { title: 'Prove' }, { title: 'Verify' }],
}

const RESULT = { type: 'object', properties: { text: { type: 'string' }, passed: { type: 'boolean' } }, required: ['text', 'passed'] }
const WORKTREE = { type: 'object', properties: { path: { type: 'string' }, base: { type: 'string' } }, required: ['path', 'base'] }
const SHA = { type: 'object', properties: { sha: { type: 'string' } }, required: ['sha'] }
const VERDICT = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, quality: { type: 'string', enum: ['pass', 'fail'] }, findings: { type: 'array', items: { type: 'string' } }, raw: { type: 'string' } },
  required: ['pass', 'quality', 'findings', 'raw'],
}

if (!args?.claim || !args?.brief || !args?.id) throw new Error('feature needs args {id, claim, brief, proof?, risk?}. Fix: pass a short id, the claim as checkable points and the quality brief.')
const { id, claim, brief, proof = 'make verify', risk = 'medium' } = args
const { path, base } = await agent(
  `Run in the repo root and return the absolute worktree path and BASE: BASE=$(git rev-parse HEAD); P=$HOME/.cache/slice/$(git rev-parse --show-toplevel | cksum | cut -d' ' -f1)/wt/${id}; git worktree add -b slice-${id} "$P" HEAD; [ -f .slice-env ] && cp .slice-env "$P/"`,
  { label: 'worktree', phase: 'Build', schema: WORKTREE },
)

let findings = []
if (proof !== 'make verify') {
  const red = await agent(`Call the tool mcp__slice__slice once with action "prove", cmd "${proof}", cwd "${path}" before any change. Return passed=true only if the answer contains "PASS", and put the answer verbatim in text.`, { label: 'red baseline', phase: 'Prove', schema: RESULT })
  if (red?.passed) findings = [`The proof ${proof} already passes before any change, so it does not prove the claim. Write or change a check that fails without the feature first.`]
}
for (let round = 1; round <= 3; round++) {
  const hint = round === 3 ? ' Rounds 1 and 2 failed: rethink the approach before you change code.' : ''
  await agent(
    `Worktree: ${path}\nClaim:\n${claim}\nQuality brief:\n${brief}\nFindings to fix (empty on round 1):\n${findings.join('\n')}${hint}`,
    { agentType: 'slice:builder', label: `builder r${round}`, phase: 'Build' },
  )
  let proved
  for (let t = 0; t < 3; t++) {
    proved = await agent(
      `Call the tool mcp__slice__slice once with action "prove", cmd "${proof}", cwd "${path}". Load the tool with ToolSearch if needed. Do not run anything else and do not interpret the answer. Return passed=true only if the answer contains "PASS", and put the answer verbatim in text.`,
      { label: `prove r${round}`, phase: 'Prove', schema: RESULT },
    )
    if (!/\] BUSY /.test(proved?.text ?? '')) break
    await agent('Run: sleep 60', { label: 'wait for lock', phase: 'Prove', model: 'haiku' })
  }
  if (!/^\[slice harness\] PASS /.test(proved?.text ?? '')) {
    findings = [`The harness proof failed:\n${proved?.text ?? 'no answer'}`]
    continue
  }
  const { sha } = await agent(
    `In ${path}: git add -A -- . ':!.slice-env' && git commit -q -m "slice: candidate ${id}" && git rev-parse HEAD. Return the sha.`,
    { label: 'candidate', phase: 'Verify', schema: SHA },
  )
  const v = await agent(
    `Work in ${path}. Diff: git diff ${base}..${sha}. Scratch folder (the only place you may write; pass it as --out to scripts/ui-check.mjs): $(git rev-parse --path-format=absolute --git-common-dir)/slice/verify. Read the verification section of AGENTS.md and any .claude/skills/run-* recipe there.\nClaim:\n${claim}\nQuality brief:\n${brief}\nProof output:\n${proved.text}\nEnd with the VERDICT line and copy it to raw.`,
    { agentType: 'slice:verifier', label: `verifier r${round}`, phase: 'Verify', schema: VERDICT, ...(risk === 'high' ? { model: 'opus' } : {}) },
  )
  const fence = await agent(`Run: git -C ${path} status --porcelain; git -C ${path} rev-parse HEAD. If the status is not empty or HEAD is not ${sha}, run git -C ${path} reset --hard ${sha} && git -C ${path} clean -fd. Return clean=true only if nothing had to be reset.`, { label: 'fence', phase: 'Verify', schema: { type: 'object', properties: { clean: { type: 'boolean' } }, required: ['clean'] } })
  if (v?.pass && v.quality === 'pass' && fence?.clean) return { status: 'verified', worktree: path, base, sha, proof: proved.text, verdict: v.raw }
  findings = v?.findings ?? ['The verifier gave no answer.']
}
return { status: 'stuck', worktree: path, findings, question: 'Three rounds failed. Options: change the approach, narrow the claim, or stop. Which?' }
