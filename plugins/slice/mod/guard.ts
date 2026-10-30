import type { EngineInterface, On } from 'claude-code'

import { S, loadState, logEvent, modeOf, typeOf, type Mode } from './state'

type Input = Record<string, unknown>
type Ctx = { mode: Mode; type?: string; frozen: string[]; prior: string[]; at?: string }
type Verdict = { decision: 'deny' | 'ask'; reason: string }
const W = String.raw`(?:(?:env|time|nohup|sudo|npx|uvx|npm\s+exec|pnpm|yarn|bunx?|exec|dlx|uv\s+run|timeout\s+\d+\S*|python3?\s+-m|(?:ba|z)?sh\s+-c|-\S+|\w+=(?:"[^"]*"|'[^']*'|\S*))\s+)*`
const RUNNER = new RegExp(String.raw`^\s*${W}(?:\S*/)?(?:vitest|jest|pytest|playwright\s+test|cargo\s+test|go\s+test)\b`)
const GIT = new RegExp(String.raw`^\s*${W}(?:\S*/)?git\b`)
const GIT_MUT = new RegExp(String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|-\S+))*\s+(?:commit|add|checkout|reset|restore|stash|merge|rebase|push|clean|apply|cherry-pick|tag|worktree|update-ref|replace|switch|pull|rm|mv|commit-tree|branch\s+-D|config(?!\s+(?:--get|--list|-l\b)))\b`)
const GIT_RUN = /--no-verify|core\.hooksPath|\bcommit\b.*\s-[a-z]*n\b|\bpush\b.*(?:--force|\s-[a-z]*f|\s\+\S)/
const SKIP = /\.(?:skip|only)\s*\(|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|\bit\.todo\b|test\.fixme|@pytest\.mark\.skip|\bt\.Skip(?:Now|f)?\(/
const CI_SCRIPT = /(^|\/)([Mm]akefile|GNUmakefile|package\.json|\.gitlab-ci\.yml|[^/]+\.(sh|mk)|\.github\/workflows\/[^/]+)$/
const ASK_PATH = /(^|\/)(\.git\/hooks\/|\.husky\/|\.github\/workflows\/|\.claude\/(slice\.json|settings[^/]*$)|[Mm]akefile$|GNUmakefile$|[^/]+\.mk$|\.env(?:\.[\w.-]+)?$|package(?:-lock)?\.json$|pnpm-lock\.yaml$|yarn\.lock$|adrs?\/[^/]+\.md$|scripts\/(slice-lock\.sh|ui-check\.mjs)$|(DESIGN|NORTHSTAR)\.md$)/
const OWN_STATE = 'slice writes its own state and notes. Fix: use the slice tool (note, prove, done).'
const deny = (reason: string): Verdict => ({ decision: 'deny', reason })
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const segments = (cmd: string) => cmd.replace(/\b((?:ba|z)?sh\s+-c)\s+["']/g, '$1 ').split(/&&|\|\||[;|&\n()]/)
const gitSeg = (cmd: string, re: RegExp) => segments(cmd).some(s => GIT.test(s) && re.test(s))
export const runsTests = (cmd: string): boolean => segments(cmd).some(s => RUNNER.test(s) || /^\s*(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t)\b|^\s*node\s+--test\b|^\s*mocha\b/.test(s))
export const isSliceState = (s: string, dir: string): boolean => /\.git\/slice\/(state|notes|cache|log)/.test(s) || [`${dir}/state`, `${dir}/notes`, `${dir}/cache`, `${dir}/log`].some(p => s.includes(p))
export const writesState = (cmd: string, dir: string): boolean =>
  segments(cmd.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, '')).some(s => isSliceState(s, dir) && (/>|\b(tee|rm|truncate|dd)\b|sed\s+-i/.test(s) || (/\b(cp|mv|ln)\b/.test(s) && isSliceState(s.trim().split(/\s+/).at(-1) ?? '', dir))))
export const addedLines = (i: Input, prior: string[] = []): string[] =>
  ((Array.isArray(i.edits) ? i.edits : [i]) as Input[]).flatMap(x => (str(x.new_string) + str(x.content)).split('\n').filter(l => !str(x.old_string).split('\n').includes(l) && !prior.includes(l)))
export const isFrozen = (path: string, files: string[], root: string): boolean =>
  files.map(f => f.replace(/^\.\//, '')).some(f => path === f || path === `${root}/${f}` || (f.includes('/') && path.startsWith(`${root}/`) && path.endsWith(`/${f}`)))
// A builder may add its own verify-* target to the Makefile in its worktree: new targets and recipes, longer .PHONY and verify: lines
export function addsVerifyTarget(i: Input, prior: string[]): boolean {
  const edits = (Array.isArray(i.edits) ? i.edits : [i]) as Input[]
  if (!str(i.content) && !edits.every(x => prior.join('\n').includes(str(x.old_string)))) return false
  const text = str(i.content) || edits.reduce((t, x) => t.replace(str(x.old_string), str(x.new_string)), prior.join('\n'))
  const [after, old] = [text.split('\n'), prior]
  const [head, added] = [(l: string) => /^(\.PHONY|verify):/.test(l) ? l.split(':')[0] : '', after.filter(l => !old.includes(l))]
  const grows = (l: string) => !!head(l) && added.some(a => head(a) === head(l) && l.split(/\s+/).every(t => a.split(/\s+/).includes(t)))
  // A second recipe for a target overrides the first in GNU make: a verify-* name may appear once
  const names = after.filter(l => /^verify-[\w-]+:/.test(l)).map(l => l.split(':')[0]!.trim())
  return new Set(names).size === names.length && old.filter(l => !after.includes(l)).every(grows) && added.every(l => /^(verify-[\w-]+:.*|\t.*|#.*|\s*)$/.test(l) || old.some(o => head(o) && head(o) === head(l)))
}

export function judge(tool: string, i: Input, c: Ctx): Verdict | undefined {
  const [run, cmd, path] = [c.mode !== 'interactive', str(i.command), c.at ?? str(i.file_path)]
  if (tool === 'Bash') {
    if (run && runsTests(cmd)) return deny('Direct test runners skip the lock and the cache. Fix: use `make test-affected FILES=…`.')
    if (run && gitSeg(cmd, GIT_RUN)) return deny('Hooks and force pushes are off limits in a run. Fix: drop --no-verify, --force and core.hooksPath and fix the cause.')
    if (c.type === 'slice:verifier' && gitSeg(cmd, GIT_MUT)) return deny('The verifier must not change git state. Fix: only read (git diff, git log, git status).')
    return writesState(cmd, S.dir) ? deny(OWN_STATE) : undefined
  }
  const lines = addedLines(i, c.prior)
  if (/(test|spec)/i.test(path) && lines.some(l => SKIP.test(l))) return deny('Disabling tests hides failures. Fix: remove .skip/.only/xit; fix the test or ask the person.')
  if (CI_SCRIPT.test(path) && lines.some(l => /\|\|\s*true\b/.test(l))) return deny('`|| true` hides failures in tests and CI. Fix: remove it and fix the failing step.')
  if (isSliceState(path, S.dir)) return deny(OWN_STATE)
  if (run && path.includes('.claude/skills/verify/')) return deny('The verify skill is fixed during a run. Fix: leave it and report what is missing in your result.')
  if (c.type === 'slice:verifier' && (/(^|\/)\.\.(\/|$)/.test(path) || !path.startsWith(`${S.dir}/verify/`))) return deny(`The verifier writes only to ${S.dir}/verify/. Fix: put scratch files there.`)
  if (c.type === 'slice:builder' && /(^|\/)[Mm]akefile$/.test(path) && !isFrozen(path, c.frozen, S.root) && addsVerifyTarget(i, c.prior)) return undefined
  if (ASK_PATH.test(path) || isFrozen(path, c.frozen, S.root)) return { decision: 'ask', reason: `${path} is a frozen proof, hook, CI, dependency, secret, ADR or owner path. Fix: ask the person to approve, or work on a copy.` }
}

const counts = new Map<string, number>()
const stuck = new Map<string, string>()
export const resetDenials = (): void => (counts.clear(), stuck.clear())
async function countDenial($: EngineInterface, who: string, reason: string): Promise<void> {
  counts.set(who, (counts.get(who) ?? 0) + 1)
  if (counts.get(who)! < 5) return
  const msg = `stuck: permissions. ${who} was denied 5 times, last: ${reason.replace(/ Fix:.*/, '')} Fix: change the approach, or ask the person to take the step.`
  if (who === 'main') S.halt = msg
  else stuck.set(who, msg)
  await logEvent($, 'stuck', { who, reason })
}
// The worktree of this repo that holds path, or '' for the main checkout and anything else
async function worktreeOf($: EngineInterface, path: string): Promise<string> {
  const script = 'd=$(dirname "$1"); while [ ! -d "$d" ]; do d=$(dirname "$d"); done; git -C "$d" rev-parse --path-format=absolute --show-toplevel --git-common-dir'
  const r = await $.process.run(['sh', '-c', script, 'sh', path])
  const [top, common] = r.stdout.trim().split('\n')
  return r.exitCode === 0 && top && top !== S.root && common === S.dir.replace(/\/slice$/, '') ? top : ''
}
export const register = (on: On): void => {
  // A failed hook counts as absent, so the catch turns a mod error into a deny
  on('tool.check', { tool: /^(Bash|Edit|Write|MultiEdit)$/ }, async ($, e, next) => {
    const who = e.agentId ?? 'main'
    if (!S.active) return next(e)
    if (stuck.has(who)) return deny(stuck.get(who)!)
    const [input, isFile] = [(e.input ?? {}) as Input, e.tool !== 'Bash']
    const [path, type] = [str(input.file_path), await typeOf($, e.agentId)]
    const frozen = isFile ? Object.values((await loadState($))?.proofs ?? {}).filter(p => p.amend !== 'open').flatMap(p => p.files) : []
    const prior = (e.tool === 'Write' || /(^|\/)[Mm]akefile$/.test(path)) && (await $.fs.exists(path)) ? (await $.fs.read(path)).split('\n') : []
    let wt = ''
    if (isFile && type === 'slice:builder') wt = await worktreeOf($, path)
    const out = isFile && type === 'slice:builder' && !wt
    // Frozen proofs are named relative to the repo, so in a worktree they are matched against its own root
    const v = out ? deny('Builders edit only in a worktree of this repo, not the main checkout or elsewhere. Fix: work in your worktree.') : judge(e.tool, input, { mode: modeOf(e.agentId, S.isRun, S.interactive), type, frozen, prior, at: wt ? S.root + path.slice(wt.length) : path })
    if (!v) return counts.delete(who), next(e)
    if (v.decision === 'deny') await countDenial($, who, v.reason)
    // Nobody can answer in a run: the ask is refused there, so the person hears of it
    else if (S.isRun || !S.interactive) await logEvent($, 'asked', { slice: S.slice, path, reason: v.reason })
    // Undocumented value (the types name only 'host'); on 2.1.312 it shows the dialog under acceptEdits and in auto mode
    return v.decision === 'ask' ? { ...v, decider: 'person' as never } : v
  }).catch(($, e, next) => ({ decision: 'deny', reason: `slice guard failed: ${next.error}. Fix: restart the session.` }))
}
