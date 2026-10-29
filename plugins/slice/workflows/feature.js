export const meta = {
  name: 'feature',
  description: 'Supervised feature: builder in a worktree, proof run by the slice tool, fresh verifier, back to the builder up to 3 rounds',
  phases: [{ title: 'Build' }, { title: 'Prove' }, { title: 'Verify' }],
}

const RESULT = { type: 'object', properties: { text: { type: 'string' }, passed: { type: 'boolean' } }, required: ['text', 'passed'] }
const VERDICT = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, findings: { type: 'array', items: { type: 'string' } }, raw: { type: 'string' } },
  required: ['pass', 'findings', 'raw'],
}

const { claim, brief, proof = 'make verify' } = args
const { path, base } = await agent(
  `Run in the repo root: BASE=$(git rev-parse HEAD); P=$HOME/.cache/slice/$(basename "$PWD")-$(git rev-parse --short HEAD)/wt/f1; git worktree add -b slice-f1 "$P" HEAD; if [ -f .slice-env ]; then cp .slice-env "$P/"; fi. Return the absolute worktree path and BASE.`,
  { label: 'worktree', phase: 'Build', schema: { type: 'object', properties: { path: { type: 'string' }, base: { type: 'string' } }, required: ['path', 'base'] } },
)

let findings = []
for (let round = 1; round <= 3; round++) {
  const hint = round === 3 ? ' Rounds 1 and 2 failed: rethink the approach before you change code.' : ''
  await agent(
    `Worktree: ${path}\nClaim:\n${claim}\nQuality brief:\n${brief}\nFindings to fix (empty on round 1):\n${findings.join('\n')}${hint}`,
    { agentType: 'slice:builder', label: `builder r${round}`, phase: 'Build' },
  )
  const proved = await agent(
    `Call the tool mcp__slice__slice once with action "prove", cmd "${proof}", cwd "${path}". Do not run anything else and do not interpret the answer. Return passed=true only if the answer starts with PASS or "cached", and put the answer verbatim in text.`,
    { label: `prove r${round}`, phase: 'Prove', schema: RESULT },
  )
  if (!proved.passed) {
    findings = [`The harness proof failed:\n${proved.text}`]
    continue
  }
  const sha = await agent(`In ${path}: git add -A && git commit -qm "slice: candidate" && git rev-parse HEAD. Return the sha only.`, { label: 'candidate', phase: 'Verify' })
  const v = await agent(
    `Worktree: ${path}\nDiff: git diff ${base}..${String(sha).trim()}\nClaim:\n${claim}\nQuality brief:\n${brief}\nProof output:\n${proved.text}\nEnd with the VERDICT line, copy it to raw.`,
    { agentType: 'slice:verifier', label: `verifier r${round}`, phase: 'Verify', schema: VERDICT },
  )
  if (v.pass) return { status: 'verified', worktree: path, base, sha: String(sha).trim(), proof: proved.text, verdict: v.raw }
  findings = v.findings
}
return { status: 'stuck', worktree: path, findings, ask: 'Three rounds failed; the person decides how to continue.' }
