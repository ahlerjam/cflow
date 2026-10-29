import type { EngineInterface as Eng, On } from 'claude-code'
import { S, events, git, loadState, logEvent, saveState } from './state'
import { prove, snapshot } from './witness'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
// A red baseline must fail on an assertion: a missing module, command or target proves nothing
const NOT_RED = /Cannot find module|command not found|No rule to make target|ModuleNotFoundError|ImportError|SyntaxError|ERR_MODULE_NOT_FOUND|is not defined/
const ASSERTED = /AssertionError|assert|expect|Expected|toBe|toEqual|FAIL\b|not ok/

export async function wtRoot($: Eng): Promise<string> {
  return `${await $.env.get('HOME')}/.cache/slice/${(await $.process.run(['sh', '-c', 'printf %s "$1" | cksum | cut -d" " -f1', 'sh', S.root])).stdout.trim()}`
}

export async function worktree($: Eng, a: Record<string, unknown>): Promise<string> {
  const id = str(a.id)
  if (!/^[\w-]+$/.test(id)) return 'Rejected: id must be letters, digits, _ or -.'
  const path = `${await wtRoot($)}/wt/${id}`
  const base = str(a.base) || (await loadState($))?.run?.branch || 'HEAD'
  if (!(await $.fs.exists(path))) {
    const exists = (await $.process.run(['git', '-C', S.root, 'rev-parse', '--verify', '-q', `slice-${id}`])).exitCode === 0
    if (exists) await git($, S.root, 'worktree', 'add', path, `slice-${id}`)
    else await git($, S.root, 'worktree', 'add', '-b', `slice-${id}`, path, base)
    if (await $.fs.exists(`${S.root}/.slice-env`)) await $.process.run(['cp', `${S.root}/.slice-env`, `${path}/`])
  }
  const sha = await git($, path, 'merge-base', 'HEAD', base)
  return (await logEvent($, 'worktree', { id, path, base: sha }), `worktree ${path} base ${sha}`)
}

export async function commit($: Eng, cwd: string, id: string): Promise<string> {
  await git($, cwd, 'add', '-A', '--', '.', ':!.slice-env')
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
  const [cmd, files] = [str(a.cmd) || 'make verify', (Array.isArray(a.files) ? a.files : []).filter((f): f is string => typeof f === 'string')]
  if (!files.length) return 'Rejected: name the proof test files you wrote. Fix: pass files.'
  const out = await prove($, { cmd }, cwd, agentId)
  if (out.startsWith('PASS')) return `Not red: ${cmd} passes before the code exists, so it proves nothing. Fix: make the proof fail on the missing behaviour.`
  if (!out.startsWith('FAIL') || NOT_RED.test(out) || !ASSERTED.test(out)) return `Not red: the failure is not a failed assertion.\n${out}\nFix: let the test import and run, and fail on the expected value.`
  const st = await loadState($)
  const key = `${S.slice || 'feature'}:${cmd}`
  if (st && !st.proofs[key]) await saveState($, { ...st, proofs: { ...st.proofs, [key]: { cmd, files } } })
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
  const ev = await events($)
  const rev = ev.filter(x => x.event === 'reviewed').at(-1)
  return !!rev && (rev.tree === tree || ev.some(x => x.event === 'prove' && x.pass && x.tree === tree && x.t > rev.t))
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
