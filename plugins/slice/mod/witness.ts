import type { EngineInterface as Eng, On, ToolSpec } from 'claude-code'
import { lockArgv } from './lock'
import { S, events, loadState, logEvent, modeOf, recentMisses, saveState, typeOf } from './state'
import { amend, bugWasRed, commit, fence, red, reviewOk, worktree } from './flow'
import { runAction } from './run'

// Only FILE and FILES may be set: any other variable can override the recipe the proof stands for
const MAKE = /^make (?:check|verify|test-affected|verify-[\w-]+)(?: FILES?=[\w./,:@+-]*)*$/
const MD_OK = /^(?:(?:.*\/)?(?:README|AGENTS|CLAUDE|CLAUDE\.local|DESIGN|NORTHSTAR)\.md$|docs\/adr\/\d{4}-[\w-]+\.md$)/
const SCANS: [RegExp, string][] = [[/\b(TO|FIX)(DO|ME)\b/, 'TODO/FIXME left in'], [/not impl[e]mented|NotImpl[e]mented|unimpl[e]mented!|pass\s+# stub/, 'stub left in'], [/lorem ipsum|placeholder text|\bTB[D]\b/i, 'placeholder text']] // character classes keep the scans from flagging their own source
const IS_TEST = /\.(test|spec)\.|(^|\/)test_|_test\.|(^|\/)(tests?|__tests__)\//
const HAS_TEST = /\b(it|test)(\.\w+)*\s*\(|def test_|func Test/
const HAS_VALUE = /\bexpect\s*\(|\bassert|\brequire\.|\bt\.(Error|Fatal)f?\(|\.should\b|pytest\.raises/
const VERDICT = { low: 1, medium: 2, high: 3 }
const str = (v: unknown) => (typeof v === 'string' ? v : '')
export const allowed = (cmd: string, proofs: Record<string, { cmd: string }>): boolean => MAKE.test(cmd) || Object.values(proofs).some(p => p.cmd === cmd)
export const cacheKey = (tree: string, cmd: string): string => `${tree}-${cmd.replace(/\W+/g, '_')}`
export const scan = (diff: string): string[] =>
  diff.split(/^diff --git /m).slice(1).flatMap(b => {
    const [f, text] = [/^\+\+\+ b\/(.*)$/m.exec(b)?.[1] ?? '', b.slice(b.indexOf('\n@@')).split('\n').filter(l => l[0] === '+').join('\n')]
    const why = SCANS.filter(([re]) => re.test(text)).map(([, w]) => w)
    if (IS_TEST.test(f) && HAS_TEST.test(text) && !HAS_VALUE.test(text)) why.push('test without a value assertion')
    if (/^--- \/dev\/null/m.test(b) && f.endsWith('.md')  && !MD_OK.test(f)) why.push('new Markdown file outside the allowlist')
    return why.map(w => `${f}: ${w}`)
  })
export async function snapshot($: Eng, cwd: string): Promise<{ tree: string; diff: string }> {
  const env = { GIT_INDEX_FILE: `${S.dir}/idx.${Math.random().toString(36).slice(2)}` }
  const git = (...args: string[]) =>
    $.process.run(['git', '-C', cwd, ...args], { env }).then(r => (r.exitCode === 0 && !r.isStdoutTruncated ? r.stdout : Promise.reject(new Error(`slice: git ${args[0]} failed: ${r.stderr.trim() || 'output too large'}`))))
  // Builders may commit in their worktree: scan everything since the run branch, else the main checkout's HEAD; the vendored copy in .slice/ is not the slice's work
  const run = S.isRun ? (await loadState($))?.run?.branch : undefined
  const base = (await git('merge-base', 'HEAD', (await $.process.run(['git', '-C', S.root, 'rev-parse', run || 'HEAD'])).stdout.trim())).trim()
  try { return (await git('add', '-A'), { tree: (await git('write-tree')).trim(), diff: await git('diff', '--cached', '-U0', base, '--', '.', ':!.slice') }) } finally { await $.process.run(['rm', '-f', env.GIT_INDEX_FILE]) }
}
async function hit($: Eng, tree: string, cmd: string): Promise<{ t: number } | undefined> {
  const f = `${S.dir}/cache/${cacheKey(tree, cmd)}`
  const c = (await $.fs.exists(f)) ? JSON.parse(await $.fs.read(f)) : undefined
  return c?.cmd === cmd ? c : undefined
}
export async function prove($: Eng, a: Record<string, unknown>, cwd: string, agentId?: string): Promise<string> {
  const cmd = str(a.cmd) || 'make verify'
  if (!allowed(cmd, (await loadState($))?.proofs ?? {})) return `Rejected: ${cmd} is not an allowed proof command. Fix: use make check, verify, test-affected or verify-*, or freeze it first: slice note with cmd and files.`
  const { tree, diff } = await snapshot($, cwd)
  const [bad, cached, short, t0] = [scan(diff), await hit($, tree, cmd), tree.slice(0, 10), await $.clock.now()]
  if (bad.length) return `Rejected before running anything:\n${bad.join('\n')}\nFix: remove these from the diff, then prove again.`
  if (cached) return `PASS ${cmd} on ${short}, cached from ${new Date(cached.t).toISOString()}`
  const g = $.process.spawn({ argv: lockArgv(cmd.split(/\s+/), { interactive: modeOf(agentId, S.isRun, S.interactive) === 'interactive' }), cwd })
  let [out, r] = ['', await g.next()]
  while (!r.done) [out, r] = [(out + r.value.text).slice(-8000), await g.next()]
  const [t1, pass] = [await $.clock.now(), r.value.code === 0]
  const busy = r.value.code === 3 && out.includes('slice-lock: waited')
  if (!busy) await logEvent($, 'prove', { cmd, tree, pass, slice: S.slice })
  if (!pass) return busy ? `BUSY ${cmd}: another slice proof holds the machine lock. Fix: call prove again in a minute; this is not a failure of the code.` : `FAIL ${cmd} (exit ${r.value.code ?? r.value.signal})\n${out.trim().split('\n').slice(-40).join('\n')}`
  await $.fs.write(`${S.dir}/cache/${cacheKey(tree, cmd)}`, JSON.stringify({ t: t1, cmd }))
  const st = await loadState($)
  const open = Object.entries(st?.proofs ?? {}).filter(([, p]) => p.cmd === cmd && p.amend === 'open')
  if (st && open.length) await saveState($, { ...st, proofs: { ...st.proofs, ...Object.fromEntries(open.map(([k, p]) => [k, { ...p, amend: 'used' as const }])) } })
  return `PASS ${cmd} on ${short} (${Math.round((t1 - t0) / 1000)}s)`
}
// Every allowed proof once: make verify plus each frozen proof whose slice merged, each from cache where the tree is unchanged
export async function proveAll($: Eng, cwd: string, agentId?: string): Promise<string> {
  const st = await loadState($)
  const cmds = [...new Set(['make verify', ...Object.entries(st?.proofs ?? {}).filter(([k]) => !st?.run?.queue.some(x => k.startsWith(`${x.id}:`) && x.status !== 'merged')).map(([, p]) => p.cmd), ...(st?.run?.queue ?? []).filter(x => x.status === 'merged').map(x => x.proof)])]
  const outs: string[] = []
  for (const cmd of cmds) outs.push(await prove($, { cmd }, cwd, agentId))
  const bad = outs.filter(o => !o.startsWith('PASS'))
  const { tree } = await snapshot($, cwd)
  await logEvent($, 'prove-all', { tree, pass: !bad.length, n: cmds.length })
  return bad.length ? `FAIL ${bad.length} of ${cmds.length} proofs\n${bad.join('\n')}` : `all ${cmds.length} proofs green on ${tree.slice(0, 10)}`
}
async function done($: Eng, a: Record<string, unknown>, cwd: string): Promise<string> {
  const [level, cmd] = [str(a.level) as keyof typeof VERDICT, str(a.cmd) || 'make verify']
  const run = (await loadState($))?.run?.queue.find(x => x.id === S.slice)
  const kind = run?.kind ?? str(a.kind)
  if (!VERDICT[level]) return 'Rejected: level is required. Fix: pass level low, medium or high.'
  const [{ tree, diff }, st, now] = [await snapshot($, cwd), await loadState($), await $.clock.now()]
  const touched = [...diff.matchAll(/^\+\+\+ b\/(.*)$/gm)].map(m => m[1]!)
  const floor = touched.some(f => recentMisses(st, now).some(m => m.includes(f))) ? 'high' : touched.some(f => (S.marker.corePaths ?? []).some(p => f.startsWith(p))) ? 'medium' : 'low'
  if (Object.keys(VERDICT).indexOf(level) < Object.keys(VERDICT).indexOf(floor)) return `Refused: the diff touches ${floor === 'high' ? 'a path from a /slice-miss note' : 'core paths'}, so the level is at least ${floor}. Fix: close with level ${floor}.`
  if (!/^make verify(?:-[\w-]+)?(?: |$)/.test(cmd) && !Object.values(st?.proofs ?? {}).some(p => p.cmd === cmd)) return `Refused: ${cmd} is too narrow to close a slice. Fix: prove make verify, a verify-* target or a frozen proof.`
  if (!(await hit($, tree, cmd))) return 'Refused: no passed proof for the current tree. Fix: run slice prove again, the tree changed.'
  if (kind === 'bug' && !(await bugWasRed($, cmd, S.slice))) return `Refused: a bug fix needs ${cmd} to FAIL before the fix. Fix: prove the failing test first, then fix.`
  let skipped = false
  if (level === 'medium' && !(await reviewOk($, tree))) {
    // A skip is the person's word, asked by the mod itself; the agent's verdict never counts
    if (!S.interactive || S.isRun || (await $.ui.ask('slice: close this medium slice without /code-review?', ['Run /code-review first', 'Skip the review']).catch(() => '')) !== 'Skip the review') return 'Refused. Medium needs /code-review on this tree (run it yourself: /code-review high), or the person skips it.'
    skipped = true
  }
  if (level === 'high' && (await events($)).filter(x => x.event === 'verdict' && x.tree === tree).at(-1)?.verdict !== 'pass') return 'Refused. High needs a pass the slice:verifier recorded on this tree. Fix: run /slice:feature with risk high.'
  return (await logEvent($, 'done', { level, tree, skipped, slice: S.slice }), 'done')
}
async function verdict($: Eng, a: Record<string, unknown>, cwd: string, type?: string, agentId?: string): Promise<string> {
  if (type !== 'slice:verifier' || !/^(pass|fail)$/.test(str(a.verdict))) return 'Rejected: only the slice:verifier agent records a verdict, pass or fail.'
  const { tree } = await snapshot($, cwd)
  return (await logEvent($, 'verdict', { tree, verdict: a.verdict, agentId, slice: S.slice || cwd.split('/').pop(), findings: str(a.text) }), `verdict ${a.verdict} recorded for ${tree.slice(0, 10)}`)
}
async function note($: Eng, a: Record<string, unknown>): Promise<string> {
  const [cmd, text, state, files] = [str(a.cmd), str(a.text), await loadState($), (Array.isArray(a.files) ? a.files : []).filter((f): f is string => typeof f === 'string')]
  if (!cmd) return text ? (await logEvent($, 'note', { text, confidence: a.confidence, slice: S.slice }), 'noted') : 'Rejected: nothing to note. Fix: pass text, or cmd and files to freeze a proof.'
  if (!state || !files.length || !/^make [\w][\w.-]*(?: FILES?=[\w./,:@+-]*)*$/.test(cmd)) return 'Rejected: freezing needs a make command and the files it proves. Fix: pass both, or restart the session.'
  if (state.proofs[text || cmd]) return `Rejected: ${text || cmd} is frozen already. Fix: ask the person to change it, or freeze a new proof under another text.`
  await saveState($, { ...state, proofs: { ...state.proofs, [text || cmd]: { cmd, files } } })
  return (await logEvent($, 'freeze', { cmd, files }), `frozen ${cmd}`)
}
export const TOOL: ToolSpec = { name: 'slice', description: 'The slice harness runs the proof, you do not. prove: run an allowed make target (default make verify; all: every proof) and report PASS or FAIL. red: the failing baseline before the code, which freezes the proof files. done: close a slice after a passing proof (needs level). note: freeze a proof (cmd, files) or log a decision (text, confidence). amend: open a frozen proof once (text = its name, verdict = why). verdict: the slice:verifier records pass or fail. worktree, commit, fence: worktree steps of /slice:feature. queue, start, merge, add, accept, report: the run (see /slice:shape, /slice:run, /slice:accept).',
  inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['prove', 'red', 'done', 'note', 'amend', 'verdict', 'worktree', 'commit', 'fence', 'queue', 'start', 'merge', 'add', 'accept', 'report'] }, cmd: { type: 'string' }, all: { type: 'boolean' }, level: { enum: ['low', 'medium', 'high'] }, kind: { type: 'string' }, verdict: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'number' }, files: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, sha: { type: 'string' }, base: { type: 'string' }, stage: { type: 'object', description: 'queue: {stage, budget, maxHours, online, slices: [{id, kind, claim, brief, proof, risk, after, cloud, ui}]}; add: one slice' }, cwd: { type: 'string', description: 'Absolute path of a worktree of this repo' } } },
}
export const register = (on: On): void => {
  // No .catch: a mod error must block the call
  on('tool.call', { tool: /^mcp__slice__slice$/ }, async ($, e) => {
    const [a, say] = [e as Record<string, unknown>, (text: string) => ({ result: `[slice harness] ${text}` })]
    if (!S.active) return say('slice is not set up here (run /slice:setup)')
    const type = await typeOf($, e.agentId)
    if (type === 'slice:verifier' && a.action !== 'verdict') return say('The verifier only records a verdict. Fix: call action verdict with pass or fail.')
    if (type === 'slice:builder' && !['prove', 'note', 'amend'].includes(str(a.action))) return say('Builders only prove, note and amend. Fix: leave the other steps to the workflow.')
    if (a.action === 'note') return say(await note($, a))
    if (a.action === 'amend') return say(await amend($, a))
    if (a.action === 'worktree') return say(await worktree($, a))
    const ran = await runAction($, a, e.agentId)
    if (ran !== undefined) return say(ran)
    const cwd = str(a.cwd) || S.root
    const common = cwd.startsWith('/') ? await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']) : undefined
    if (common?.exitCode !== 0 || common.stdout.trim() !== S.dir.replace(/\/slice$/, '')) return say('cwd is not a worktree of this repo. Fix: pass a worktree created with git worktree add.')
    const act: Record<string, () => Promise<string>> = {
      prove: () => (a.all ? proveAll($, cwd, e.agentId) : prove($, a, cwd, e.agentId)),
      red: () => red($, a, cwd, e.agentId),
      done: () => done($, a, cwd),
      verdict: () => verdict($, a, cwd, type, e.agentId),
      commit: () => commit($, cwd, str(a.id)),
      fence: () => fence($, cwd, str(a.sha)),
    }
    return say(await (act[str(a.action)] ?? (async () => 'Unknown action. Fix: use one the tool lists.'))())
  })
}
