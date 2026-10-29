export const meta = {
  name: 'feature',
  description: 'Supervised feature: proof tests first and red, builder in a worktree, proof run by the slice tool, fresh verifier, back to the builder up to 3 rounds',
  phases: [{ title: 'Build' }, { title: 'Prove' }, { title: 'Verify' }],
}

const TEXT = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
const VERDICT = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, quality: { type: 'string', enum: ['pass', 'fail'] }, findings: { type: 'array', items: { type: 'string' } }, raw: { type: 'string' } },
  required: ['pass', 'quality', 'findings', 'raw'],
}
const BUILT = { type: 'object', properties: { report: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['report', 'files'] }

if (!args?.claim || !args?.brief || !args?.id) throw new Error('feature needs args {id, claim, brief, proof?, risk?, kind?, base?}. Fix: pass a short id, the claim as checkable points and the quality brief.')
const { id, claim, brief, proof = 'make verify', risk = 'medium', kind = 'feature', ui = false, base = '', built = false } = args
if (!/^[\w-]+$/.test(id)) throw new Error('feature id must be letters, digits, _ or -. Fix: pass a short id such as export-umlauts.')

// One tool call, nothing else: the mod does the git work, the agent only carries the call
const tool = (action, extra, label, phase) =>
  agent(`Call the tool mcp__slice__slice exactly once with ${JSON.stringify({ action, ...extra })}. Load it with ToolSearch if needed. Do not run anything else. Put the tool's answer verbatim in text.`, { label, phase, schema: TEXT, model: 'haiku' }).then(r => r?.text ?? 'no answer')

const made = await tool('worktree', { id, ...(base ? { base } : {}) }, 'worktree', 'Build')
const m = /worktree (\S+) base (\S+)/.exec(made)
if (!m) return { status: 'stuck', findings: [made], question: 'The worktree could not be created. Fix the cause shown, then run the feature again.' }
const [, path, baseSha] = m

const ctx = `Worktree: ${path}\nKind: ${kind}${ui ? ' (UI: load the taste skill, cover empty, loading, error and long-data states)' : ''}\nClaim:\n${claim}\nQuality brief:\n${brief}`
let findings = []
let report = ''
// The proof tests come first and must fail on an assertion; the mod then freezes them
// A slice built in the cloud arrives with its frozen proof already red-tested there: start at the proof
const tests = built ? { files: [], report: 'Built in the cloud; verify and fix only.' } : await agent(`${ctx}\n\nStep 1 only: write the proof tests for the claim, no product code. ${kind === 'bug' ? 'The test reproduces the bug.' : ''} Return the test files you wrote and a short report.`, { agentType: 'slice:builder', label: 'proof tests', phase: 'Build', schema: BUILT })
const red = built ? 'red on an assertion (in the cloud)' : await tool('red', { cmd: proof, files: tests?.files ?? [], cwd: path }, 'red baseline', 'Prove')
if (!/red on an assertion/.test(red)) findings = [`The red baseline did not hold: ${red}`]
report = tests?.report ?? ''

for (let round = 1; round <= 3; round++) {
  const hint = round === 3 ? ' Rounds 1 and 2 failed: rethink the approach before you change code.' : ''
  const out = built && round === 1 ? { report } : await agent(
    `${ctx}\n\nYour report from the last step:\n${report}\nFindings to fix:\n${findings.join('\n') || 'none'}${hint}\nNow make the frozen proof pass with the smallest design that is also the best version of the claim. If a frozen proof is wrong, call the slice tool action amend once with the reason; never weaken it silently.`,
    { agentType: 'slice:builder', label: `builder r${round}`, phase: 'Build', schema: BUILT },
  )
  report = out?.report ?? report
  let proved = ''
  for (let t = 0; t < 3; t++) {
    proved = await tool('prove', { cmd: proof, cwd: path }, `prove r${round}`, 'Prove')
    if (!/\] BUSY /.test(proved)) break
  }
  if (!/^\[slice harness\] PASS /.test(proved)) {
    findings = [`The harness proof failed:\n${proved}`]
    continue
  }
  const cand = await tool('commit', { id, cwd: path }, 'candidate', 'Verify')
  const sha = /candidate ([0-9a-f]{7,40})/.exec(cand)?.[1]
  if (!sha) return { status: 'stuck', worktree: path, findings: [cand], question: 'The candidate could not be committed. Check the pre-commit hook output.' }
  const v = await agent(
    `Work in ${path}. Diff: git diff ${baseSha}..${sha}. Scratch folder (the only place you may write; pass it as --out to scripts/ui-check.mjs): $(git rev-parse --path-format=absolute --git-common-dir)/slice/verify. Read the verification section of AGENTS.md, any .claude/skills/run-* recipe there and .slice-env for ports and paths.\nClaim:\n${claim}\nQuality brief:\n${brief}\nProof output:\n${proved}\nRecord your verdict with mcp__slice__slice (action verdict, cwd ${path}), then end with the VERDICT line and copy it to raw.`,
    { agentType: 'slice:verifier', label: `verifier r${round}`, phase: 'Verify', schema: VERDICT, ...(risk === 'high' ? { model: 'opus' } : {}) },
  )
  const fenced = await tool('fence', { cwd: path, sha }, 'fence', 'Verify')
  if (v?.pass && v.quality === 'pass' && fenced.includes('clean')) return { status: 'verified', worktree: path, base: baseSha, sha, proof: proved, verdict: v.raw, report }
  findings = v?.pass && v.quality === 'pass' ? ['The verifier changed the worktree, so its pass does not count; the fence reset it. Prove again unchanged.'] : v?.findings ?? ['The verifier gave no answer.']
}
return { status: 'stuck', worktree: path, findings, report, question: 'Three rounds failed. Options: change the approach, narrow the claim, or stop. Which?' }
