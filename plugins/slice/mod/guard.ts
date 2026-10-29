import type { EngineInterface, On } from 'claude-code'

import { S, loadState, logEvent, modeOf } from './state'
import type { Mode } from './state'

type Input = Record<string, unknown>
type Ctx = { mode: Mode; type?: string; frozen: string[]; prior: string[] }
type Verdict = { decision: 'deny' | 'ask'; reason: string }

const W = String.raw`(?:(?:env|time|nohup|sudo|npx|pnpm|yarn|bunx?|exec|dlx|uv\s+run|timeout\s+\d+\S*|python3?\s+-m|(?:ba|z)?sh\s+-c|-\S+|\w+=(?:"[^"]*"|'[^']*'|\S*))\s+)*`
const RUNNER = new RegExp(String.raw`^\s*${W}(?:\S*/)?(?:vitest|jest|pytest|playwright\s+test|cargo\s+test|go\s+test)\b`)
const GIT = new RegExp(String.raw`^\s*${W}git\b`)
const GIT_MUT = new RegExp(String.raw`\bgit(?:\s+(?:-[Cc]\s+\S+|-\S+))*\s+(?:commit|add|checkout|reset|restore|stash|merge|rebase|push|clean|apply|cherry-pick|tag|worktree|update-ref|switch|pull|rm|mv|commit-tree|branch\s+-D|config(?!\s+(?:--get|--list|-l\b)))\b`)
const GIT_RUN = /--no-verify|core\.hooksPath|\bcommit\b.*\s-[a-z]*n\b|\bpush\b.*(?:--force|\s-[a-z]*f|\s\+\S)/
const SKIP = /\.(?:skip|only)\s*\(|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(|\bit\.todo\b|test\.fixme|@pytest\.mark\.skip/
const CI_SCRIPT = /(^|\/)(Makefile|package\.json|\.gitlab-ci\.yml|[^/]+\.(sh|mk)|\.github\/workflows\/[^/]+)$/
const ASK_PATH = /(^|\/)(\.git\/hooks\/|\.husky\/|\.github\/workflows\/|\.claude\/(slice\.json|settings[^/]*$))/
const OWN_STATE = 'slice writes its own state and notes. Fix: use the slice tool (note, prove, done).'
const deny = (reason: string): Verdict => ({ decision: 'deny', reason })
const str = (v: unknown) => (typeof v === 'string' ? v : '')

const segments = (cmd: string) => cmd.replace(/\b((?:ba|z)?sh\s+-c)\s+["']/g, '$1 ').split(/&&|\|\||[;|&\n()]/)
const gitSeg = (cmd: string, re: RegExp) => segments(cmd).some(s => GIT.test(s) && re.test(s))
export const runsTests = (cmd: string): boolean => segments(cmd).some(s => RUNNER.test(s))
export const isSliceState = (s: string, dir: string): boolean => /\.git\/slice\/(state|notes|cache)/.test(s) || [`${dir}/state`, `${dir}/notes`, `${dir}/cache`].some(p => s.includes(p))
export const writesState = (cmd: string, dir: string): boolean =>
  segments(cmd.replace(/\d?>&\d|\d?>\s*\/dev\/null/g, '')).some(s => isSliceState(s, dir) && (/>|\b(tee|rm|truncate|dd)\b|sed\s+-i/.test(s) || (/\b(cp|mv|ln)\b/.test(s) && isSliceState(s.trim().split(/\s+/).at(-1) ?? '', dir))))
export const addedLines = (i: Input, prior: string[] = []): string[] =>
  ((Array.isArray(i.edits) ? i.edits : [i]) as Input[]).flatMap(x => (str(x.new_string) + str(x.content)).split('\n').filter(l => !str(x.old_string).split('\n').includes(l) && !prior.includes(l)))
export const isFrozen = (path: string, files: string[], root: string): boolean =>
  files.map(f => f.replace(/^\.\//, '')).some(f => path === f || path === `${root}/${f}` || (f.includes('/') && path.startsWith(`${root}/`) && path.endsWith(`/${f}`)))

export function judge(tool: string, i: Input, c: Ctx): Verdict | undefined {
  const [run, cmd, path] = [c.mode !== 'interactive', str(i.command), str(i.file_path)]
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
  if (ASK_PATH.test(path) || isFrozen(path, c.frozen, S.root)) return { decision: 'ask', reason: `${path} is a frozen proof, hook, CI file or owner path. Fix: ask the person to approve, or work on a copy.` }
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

async function inWorktree($: EngineInterface, path: string): Promise<boolean> {
  const script = 'd=$(dirname "$1"); while [ ! -d "$d" ]; do d=$(dirname "$d"); done; git -C "$d" rev-parse --path-format=absolute --show-toplevel --git-common-dir'
  const r = await $.process.run(['sh', '-c', script, 'sh', path])
  const [top, common] = r.stdout.trim().split('\n')
  return r.exitCode === 0 && top !== S.root && common === S.dir.replace(/\/slice$/, '')
}

export const register = (on: On): void => {
  // No .catch: a mod error must block the call
  on('tool.check', { tool: /^(Bash|Edit|Write|MultiEdit)$/ }, async ($, e, next) => {
    const who = e.agentId ?? 'main'
    if (!S.active) return next(e)
    if (stuck.has(who)) return deny(stuck.get(who)!)
    const [input, isFile] = [(e.input ?? {}) as Input, e.tool !== 'Bash']
    const [path, type] = [str(input.file_path), e.agentId ? (await $.agent.list()).find(a => a.id === e.agentId)?.type : undefined]
    const frozen = isFile ? Object.values((await loadState($))?.proofs ?? {}).flatMap(p => p.files) : []
    const prior = e.tool === 'Write' && (await $.fs.exists(path)) ? (await $.fs.read(path)).split('\n') : []
    const out = isFile && type === 'slice:builder' && !(await inWorktree($, path))
    const v = out ? deny('Builders edit only in a worktree of this repo, not the main checkout or elsewhere. Fix: work in your worktree.') : judge(e.tool, input, { mode: modeOf(e.agentId, S.isRun, S.interactive), type, frozen, prior })
    if (!v) return counts.delete(who), next(e)
    if (v.decision === 'deny') await countDenial($, who, v.reason)
    // The shipped types list only 'host'; 'person' is accepted from Claude Code 2.1.312
    return v.decision === 'ask' ? { ...v, decider: 'person' as never } : v
  })
}
