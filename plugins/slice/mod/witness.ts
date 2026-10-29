import type { EngineInterface as Eng, On, ToolSpec } from 'claude-code'
import { lockArgv } from './lock'
import { S, loadState, logEvent, modeOf, saveState } from './state'

const MAKE = /^make (?:check|verify|test-affected|verify-[\w-]+)(?: (?!SHELL=|MAKE\w*=)\w+=[\w./,:@+-]*)*$/
const MD_OK = /^(?:docs\/adr\/|(?:.*\/)?(?:README|AGENTS|CLAUDE|CLAUDE\.local|DESIGN|NORTHSTAR)\.md$)/
const SCANS: [RegExp, string][] = [[/\b(TO|FIX)(DO|ME)\b/, 'TODO/FIXME left in'], [/not impl[e]mented|NotImpl[e]mented|unimpl[e]mented!|pass\s+# stub/, 'stub left in'], [/lorem ipsum|placeholder text|\bTB[D]\b/i, 'placeholder text']] // character classes keep the scans from flagging their own source
const IS_TEST = /\.(test|spec)\.|(^|\/)test_|_test\.|(^|\/)(tests?|__tests__)\//
const HAS_TEST = /\b(it|test)(\.\w+)*\s*\(|def test_|func Test/
const HAS_VALUE = /\bexpect\s*\(|\bassert|\brequire\.|\bt\.(Error|Fatal)f?\(|\.should\b|pytest\.raises/
const VERDICT = { low: /^/, medium: /^(reviewed|skip|pass)$/, high: /^pass$/ }
const str = (v: unknown) => (typeof v === 'string' ? v : '')
export const allowed = (cmd: string, proofs: Record<string, { cmd: string }>): boolean => MAKE.test(cmd) || Object.values(proofs).some(p => p.cmd === cmd)
export const cacheKey = (tree: string, cmd: string): string => `${tree}-${cmd.replace(/\W+/g, '_')}`
export const scan = (diff: string): string[] =>
  diff.split(/^diff --git /m).slice(1).flatMap(b => {
    const [f, text] = [/^\+\+\+ b\/(.*)$/m.exec(b)?.[1] ?? '', b.slice(b.indexOf('\n@@')).split('\n').filter(l => l[0] === '+').join('\n')]
    const why = SCANS.filter(([re]) => re.test(text)).map(([, w]) => w)
    if (IS_TEST.test(f) && HAS_TEST.test(text) && !HAS_VALUE.test(text)) why.push('test without a value assertion')
    if (/^--- \/dev\/null/m.test(b) && f.endsWith('.md') && !MD_OK.test(f)) why.push('new Markdown file outside the allowlist')
    return why.map(w => `${f}: ${w}`)
  })
async function snapshot($: Eng, cwd: string): Promise<{ tree: string; diff: string }> {
  const env = { GIT_INDEX_FILE: `${S.dir}/idx.${Math.random().toString(36).slice(2)}` }
  const git = (...args: string[]) =>
    $.process.run(['git', '-C', cwd, ...args], { env }).then(r => (r.exitCode === 0 && !r.isStdoutTruncated ? r.stdout : Promise.reject(new Error(`slice: git ${args[0]} failed: ${r.stderr.trim() || 'output too large'}`))))
  try { return (await git('add', '-A'), { tree: (await git('write-tree')).trim(), diff: await git('diff', '--cached', '-U0', 'HEAD') }) } finally { await $.process.run(['rm', '-f', env.GIT_INDEX_FILE]) }
}
async function hit($: Eng, tree: string, cmd: string): Promise<{ t: number } | undefined> {
  const f = `${S.dir}/cache/${cacheKey(tree, cmd)}`
  const c = (await $.fs.exists(f)) ? JSON.parse(await $.fs.read(f)) : undefined
  return c?.cmd === cmd ? c : undefined
}
async function prove($: Eng, a: Record<string, unknown>, cwd: string, agentId?: string): Promise<string> {
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
  await logEvent($, 'prove', { cmd, tree, pass })
  if (!pass) return `FAIL ${cmd} (exit ${r.value.code ?? r.value.signal})\n${out.trim().split('\n').slice(-40).join('\n')}`
  await $.fs.write(`${S.dir}/cache/${cacheKey(tree, cmd)}`, JSON.stringify({ t: t1, cmd }))
  return `PASS ${cmd} on ${short} (${Math.round((t1 - t0) / 1000)}s)`
}
async function done($: Eng, a: Record<string, unknown>, cwd: string): Promise<string> {
  const [level, verdict] = [str(a.level) as keyof typeof VERDICT, str(a.verdict)]
  if (!VERDICT[level]) return 'Rejected: level is required. Fix: pass level low, medium or high.'
  const { tree } = await snapshot($, cwd)
  if (!allowed(str(a.cmd) || 'make verify', (await loadState($))?.proofs ?? {}) || !(await hit($, tree, str(a.cmd) || 'make verify'))) return 'Refused: no passed proof for the current tree. Fix: run slice prove again, the tree changed.'
  if (!VERDICT[level].test(verdict)) return level === 'medium' ? "Refused. Medium: run /code-review high, or pass verdict 'skip'." : "Refused. High needs verdict 'pass' from the verifier."
  return (await logEvent($, 'done', { level, verdict, tree }), 'done')
}
async function note($: Eng, a: Record<string, unknown>): Promise<string> {
  const [cmd, text, state, files] = [str(a.cmd), str(a.text), await loadState($), (Array.isArray(a.files) ? a.files : []).filter((f): f is string => typeof f === 'string')]
  if (!cmd) return text ? (await logEvent($, 'note', { text }), 'noted') : 'Rejected: nothing to note. Fix: pass text, or cmd and files to freeze a proof.'
  if (!state || !files.length || !/^make [\w][\w.-]*(?: (?!SHELL=|MAKE\w*=)\w+=[\w./,:@+-]*)*$/.test(cmd)) return 'Rejected: freezing needs a make command and the files it proves. Fix: pass both, or restart the session.'
  await saveState($, { ...state, proofs: { ...state.proofs, [text || cmd]: { cmd, files } } })
  return (await logEvent($, 'freeze', { cmd, files }), `frozen ${cmd}`)
}
export const TOOL: ToolSpec = { name: 'slice', description: 'The slice harness runs the proof, you do not. prove: run an allowed make target (default make verify) and report PASS or FAIL. done: close a ticket after a passing proof (needs level). note: freeze a proof (cmd, files) or log text.',
  inputSchema: { type: 'object', required: ['action'], properties: { action: { enum: ['prove', 'done', 'note'] }, cmd: { type: 'string' }, level: { enum: ['low', 'medium', 'high'] }, verdict: { type: 'string' }, text: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string', description: 'Absolute path of a worktree of this repo' } } },
}
export const register = (on: On): void => {
  // No .catch: a mod error must block the call
  on('tool.call', { tool: /^mcp__slice__slice$/ }, async ($, e) => {
    const [a, say] = [e as Record<string, unknown>, (text: string) => ({ result: `[slice harness] ${text}` })]
    if (!S.active) return say('slice is not set up here (run /slice:setup)')
    if (a.action === 'note') return say(await note($, a))
    const cwd = str(a.cwd) || S.root
    const common = cwd.startsWith('/') ? await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir']) : undefined
    if (common?.exitCode !== 0 || common.stdout.trim() !== S.dir.replace(/\/slice$/, '')) return say('cwd is not a worktree of this repo. Fix: pass a worktree created with git worktree add.')
    return say(a.action === 'prove' ? await prove($, a, cwd, e.agentId) : a.action === 'done' ? await done($, a, cwd) : 'Unknown action. Fix: use prove, done or note.')
  })
}
