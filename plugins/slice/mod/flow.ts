import type { EngineInterface as Eng, On } from 'claude-code'
import { S, events, git, liveProofs, loadState, logEvent, saveState } from './state'
import { prove, snapshot } from './witness'
import { isFrozen } from './guard'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
// A red baseline must fail on an assertion: a missing module, command or target proves nothing
const NOT_RED = /Cannot find module|command not found|No rule to make target|ModuleNotFoundError|ImportError|SyntaxError|ERR_MODULE_NOT_FOUND|is not defined/
// Build files are shared by every slice and already ask the person; freezing them would block the next slice's target
const SHARED = /(^|\/)(GNUmakefile|[Mm]akefile|[^/]+\.mk|package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/
const ASSERTED = /AssertionError|assert|expect|Expected|toBe|toEqual|FAIL\b|not ok/
export async function wtRoot($: Eng): Promise<string> {
  return `${await $.env.get('HOME')}/.cache/slice/${(await $.process.run(['sh', '-c', 'printf %s "$1" | cksum | cut -d" " -f1', 'sh', S.root])).stdout.trim()}`
}
// A fresh worktree has no installed dependencies: clone them from the main checkout (APFS clone, else a link). The excludes have no trailing slash so the link matches too and git add -A never commits it
export async function shareDeps($: Eng, wt: string): Promise<void> {
  await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$1")"; for d in node_modules .venv; do grep -qxF "$d" "$1" 2>/dev/null || echo "$d" >> "$1"; done', 'sh', `${S.dir.replace(/\/slice$/, '')}/info/exclude`])
  for (const d of ['node_modules', '.venv']) if ((await $.fs.exists(`${S.root}/${d}`)) && !(await $.fs.exists(`${wt}/${d}`))) await $.process.run(['sh', '-c', 'cp -cRp "$1" "$2" 2>/dev/null || ln -s "$1" "$2"', 'sh', `${S.root}/${d}`, `${wt}/${d}`], { timeoutMs: 6e5 })
}

export async function worktree($: Eng, a: Record<string, unknown>): Promise<string> {
  const id = str(a.id)
  if (!/^[\w-]+$/.test(id)) return 'Rejected: id must be letters, digits, _ or -.'
  const path = `${await wtRoot($)}/wt/${id}`
  const base = str(a.base) || (await loadState($))?.run?.branch || 'HEAD'
  // A run always builds on the current run branch: a worktree left from an earlier attempt has a stale base or finished code
  if (S.isRun) await $.process.run(['sh', '-c', 'git -C "$1" worktree remove --force "$2" 2>/dev/null; git -C "$1" branch -D "$3" 2>/dev/null; true', 'sh', S.root, path, `slice-${id}`], { timeoutMs: 6e5 })
  if (!(await $.fs.exists(path))) {
    const exists = (await $.process.run(['git', '-C', S.root, 'rev-parse', '--verify', '-q', `slice-${id}`])).exitCode === 0
    if (exists) await git($, S.root, 'worktree', 'add', path, `slice-${id}`)
    else await git($, S.root, 'worktree', 'add', '-b', `slice-${id}`, path, base)
    for (const f of ['.slice-env', '.claude/slice.json']) if (await $.fs.exists(`${S.root}/${f}`)) await $.process.run(['sh', '-c', 'mkdir -p "$(dirname "$2")" && cp "$1" "$2"', 'sh', `${S.root}/${f}`, `${path}/${f}`])
    await shareDeps($, path)
  }
  const sha = await git($, path, 'merge-base', 'HEAD', base)
  return (await logEvent($, 'worktree', { id, path, base: sha }), `worktree ${path} base ${sha}`)
}
async function hashes($: Eng, cwd: string, files: string[]): Promise<string> { return (await $.process.run(['git', '-C', cwd, 'hash-object', '--', ...files])).stdout.trim() }
// Run slices key their proofs by id, supervised features by their branch slice-<id>
async function sliceKey($: Eng, cwd: string): Promise<string> { return S.slice || git($, cwd, 'branch', '--show-current') }
export async function commit($: Eng, cwd: string, id: string): Promise<string> {
  // .slice-env and the marker are excluded in the common git dir, so a plain add -A leaves them out
  await git($, cwd, 'add', '-A')
  // Bash can edit what the Edit guard freezes: compare the proofs with the tree the candidate would commit
  const [st, base, own] = [await loadState($), (await events($)).filter(e => e.event === 'worktree' && e.id === id).at(-1)?.base, `${await sliceKey($, cwd)}:`]
  const touched = base ? (await git($, cwd, 'diff', '--cached', '--name-only', base)).split('\n') : []
  for (const [k, p] of Object.entries(liveProofs(st))) {
    const bad = k.startsWith(own) ? !p.amend && p.h && (await hashes($, cwd, p.files)) !== p.h : touched.some(f => isFrozen(`${cwd}/${f}`, p.files, cwd))
    if (bad && p.amend !== 'open') return `Refused: the frozen proof ${k} changed in this worktree. Fix: undo the edit to ${p.files.join(', ')}, or call amend once with the reason.`
  }
  await git($, cwd, 'commit', '-q', '--allow-empty', '-m', `slice: candidate ${id || 'slice'}`)
  const sha = await git($, cwd, 'rev-parse', 'HEAD')
  return (await logEvent($, 'candidate', { id, sha }), `candidate ${sha}`)
}
export async function fence($: Eng, cwd: string, sha: string): Promise<string> {
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return 'Rejected: pass the candidate sha.'
  const dirty = (await git($, cwd, 'status', '--porcelain')) !== '' || !(await git($, cwd, 'rev-parse', 'HEAD')).startsWith(sha)
  if (dirty) await git($, cwd, 'reset', '--hard', sha), await git($, cwd, 'clean', '-fd')
  return (await logEvent($, 'fence', { sha, reset: dirty }), dirty ? 'reset: the tree had changed since the candidate' : 'clean')
}
// The baseline runs before the code exists; once it fails on an assertion the guard freezes the proof files
export async function red($: Eng, a: Record<string, unknown>, cwd: string, agentId?: string): Promise<string> {
  const [cmd, files] = [str(a.cmd) || 'make verify', (Array.isArray(a.files) ? a.files : []).filter((f): f is string => typeof f === 'string').map(f => (f.startsWith(`${cwd}/`) ? f.slice(cwd.length + 1) : f)).filter(f => !SHARED.test(f))]
  if (!files.length) return 'Rejected: name the proof test files you wrote. Fix: pass files.'
  const out = await prove($, { cmd }, cwd, agentId)
  if (out.startsWith('PASS')) return `Not red: ${cmd} passes before the code exists, so it proves nothing. Fix: make the proof fail on the missing behaviour.`
  if (!out.startsWith('FAIL') || NOT_RED.test(out) || !ASSERTED.test(out)) return `Not red: the failure is not a failed assertion.\n${out}\nFix: let the test import and run, and fail on the expected value.`
  const st = await loadState($)
  const key = `${await sliceKey($, cwd)}:${cmd}`
  // A fresh attempt of the same slice writes new proof tests: red freezes them anew
  if (st) await saveState($, { ...st, proofs: { ...st.proofs, [key]: { cmd, files, h: await hashes($, cwd, files) } } })
  return (await logEvent($, 'red', { cmd, files, slice: S.slice }), `red on an assertion; frozen ${files.join(', ')} for ${cmd}`)
}
export async function amend($: Eng, a: Record<string, unknown>): Promise<string> {
  const [st, key, why] = [await loadState($), str(a.text), str(a.verdict)]
  const p = st?.proofs[key]
  if (!st || !p) return `Rejected: no frozen proof named ${key}. Fix: pass text with the proof's name.`
  if (p.amend) return `Refused: ${key} was amended once already. Fix: leave it, or ask the person.`
  if (!why) return 'Rejected: say why the proof is wrong. Fix: pass the reason as verdict.'
  await saveState($, { ...st, proofs: { ...st.proofs, [key]: { ...p, amend: 'open' } } })
  return (await logEvent($, 'amend', { key, why }), `${key} is open for one change; the next PASS freezes it again`)
}
export async function reviewOk($: Eng, tree: string): Promise<boolean> {
  return (await events($)).some(x => x.event === 'reviewed' && x.tree === tree)
}
export async function bugWasRed($: Eng, cmd: string, slice: string): Promise<boolean> {
  const ev = await events($)
  const from = Math.max(0, ...ev.filter(x => (slice ? x.event === 'start' && x.slice === slice : x.event === 'done')).map(x => x.t))
  return ev.some(x => x.event === 'prove' && x.pass === false && x.cmd === cmd && x.t >= from)
}
export const register = (on: On): void => {
  // Only the bundled review counts: a project skill named code-review cannot stand in for it
  on('skill.prompt', { skill: 'code-review' }, async ($, e, next) => {
    if (S.active && e.source === 'built-in' && !e.pluginName) await logEvent($, 'reviewed', { tree: (await snapshot($, await $.session.cwd())).tree })
    return next(e)
  })
}
