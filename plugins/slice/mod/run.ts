import type { EngineInterface as Engine, On, ToolSpec } from 'claude-code'

import { FEATURES_PATH, goalText, onlyPassesChanged, parseFeatures, type FeatureList } from './features'
import { END_MODES, S, loadState, logEvent, saveState, type EndMode, type Run } from './state'

export const SLICE_TOOL: ToolSpec = {
  name: 'slice',
  description: [
    'Mechanics of /slice:run. action "worker" ({resume?}) returns the command line and cwd of the builder session;',
    'action "check" reads the builder\'s output file and returns the next step (resume, finish or halt);',
    'action "finish" ({mode}) ends the run as pr, feature-prs, merge or branch.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['worker', 'check', 'finish'] },
      resume: { type: 'string', description: 'worker: session_id of the builder session to continue' },
      mode: { type: 'string', enum: [...END_MODES], description: 'finish: how the run ends' },
    },
    required: ['action'],
  },
  isDeferred: false,
}

type Input = { action?: string; resume?: string; mode?: string }
type Out = {
  subtype?: string
  is_error?: boolean
  session_id?: string
  total_cost_usd?: number
  num_turns?: number
  terminal_reason?: string
}
type Step = { action: 'resume' | 'finish' | 'halt'; reason: string }
type Cmd = { ok: boolean; out: string }

const DEFAULT_BUDGET_USD = 30
const DEFAULT_MAX_TURNS = 400
const MAX_STALLS = 2
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const text = (value: unknown) => ({ result: typeof value === 'string' ? value : JSON.stringify(value, null, 2) })
const fail = (reason: string) => text(`error: ${reason}`)

export function registerRun(on: On): void {
  on('tool.call', { tool: 'mcp__slice__slice' }, async ($, e) => {
    if (!S.active) return text('error: slice is not set up here (run /slice:setup)')
    const input = e as unknown as Input
    try {
      if (input.action === 'worker') return await worker($, input.resume)
      if (input.action === 'check') return await check($)
      if (input.action === 'finish') return await finish($, input.mode ?? '')
      return fail('action must be worker, check or finish')
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  })
}

export async function runLine($: Engine): Promise<string> {
  const { run } = await loadState($)
  if (!run) return ''
  const list = await readFeatures($, run)
  const [passed, total] = typeof list === 'string' ? ['?', '?'] : [countPassed(list), list.features.length]
  return `run ${run.branch}: ${passed}/${total} passed, $${run.costUsd.toFixed(2)}, last: ${run.last || 'started'}`
}

async function notify($: Engine, message: string): Promise<void> {
  try { await $.ui.notify(message) } catch { /* no notification channel */ }
  try { await $.tool.call({ tool: 'PushNotification', message, status: 'proactive' }) } catch { /* optional */ }
}

async function cmd($: Engine, argv: string[], cwd = S.root): Promise<Cmd> {
  const r = await $.process.run(argv, { cwd, timeoutMs: 120_000 })
  return { ok: r.exitCode === 0, out: r.exitCode === 0 ? r.stdout.trim() : (r.stderr || r.stdout).trim() }
}
const git = ($: Engine, args: string[]) => cmd($, ['git', '-C', S.root, ...args])

async function readFeatures($: Engine, run: Run): Promise<FeatureList | string> {
  const path = `${run.wt}/${FEATURES_PATH}`
  return (await $.fs.exists(path)) ? parseFeatures(await $.fs.read(path)) : `${path} is missing`
}
const countPassed = (list: FeatureList) => list.features.filter(f => f.passes).length

async function option($: Engine, field: string, fallback: string): Promise<string> {
  const rows = await $.config.list().catch(() => [])
  const value = rows.find(r => r.key === `slice.${field}`)?.value
  return typeof value === 'string' && value ? value : fallback
}

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

type Json = Record<string, any>

// The sandbox protects .git from Bash writes, so everything the builder or its shell redirects touch lives outside it
async function cacheDir($: Engine): Promise<string> {
  const xdg = await $.env.get('XDG_CACHE_HOME')
  const home = await $.env.get('HOME')
  if (!xdg && !home) throw new Error('neither XDG_CACHE_HOME nor HOME is set')
  let hash = 0x811c9dc5
  for (const c of S.root) hash = Math.imul(hash ^ c.charCodeAt(0), 0x01000193) >>> 0
  const name = `${S.root.split('/').filter(Boolean).pop() ?? 'repo'}-${hash.toString(16).padStart(8, '0')}`
  return `${xdg || `${home}/.cache`}/slice/${name}`
}
const cacheOf = (run: Run) => run.wt.replace(/\/run$/, '')

async function runSettings($: Engine, wt: string): Promise<string> {
  const profile: Json = JSON.parse(await $.fs.read(`${$.plugin.root}/profiles/run.json`))
  const sandbox: Json = profile.sandbox ?? {}
  const union = (a: unknown, b: string[] | undefined) => [...new Set([...(Array.isArray(a) ? a : []), ...(b ?? [])])]
  const merged: Json = {
    ...profile,
    sandbox: {
      ...sandbox,
      excludedCommands: union(sandbox.excludedCommands, S.marker.excludedCommands),
      filesystem: { ...sandbox.filesystem, allowWrite: union(sandbox.filesystem?.allowWrite, [wt]) },
      network: { ...sandbox.network, allowedDomains: union(sandbox.network?.allowedDomains, S.marker.allowedDomains) },
    },
  }
  const path = `${cacheOf({ wt } as Run)}/run-settings.json`
  await $.fs.write(path, JSON.stringify(merged, null, 2))
  return path
}

async function workerCommand($: Engine, run: Run, resume?: string): Promise<string> {
  const [model, effort, fallback] = await Promise.all([
    option($, 'runModel', 'opus'), option($, 'runEffort', 'high'), option($, 'fallbackModel', 'sonnet'),
  ])
  const pluginDir = await $.env.get('SLICE_PLUGIN_DIR')
  const maxTurns = S.marker.maxTurns ?? DEFAULT_MAX_TURNS
  const head = resume
    ? ['-p', '--resume', quote(resume), quote('Continue toward the goal.')]
    : ['-p', quote(goalText({ maxTurns }))]
  return [
    'SLICE_RUN=1 claude', ...head,
    '--output-format json',
    `--model ${quote(model)}`,
    `--fallback-model ${quote(fallback)}`,
    `--effort ${quote(effort)}`,
    `--max-budget-usd ${S.marker.budgetUsd ?? DEFAULT_BUDGET_USD}`,
    `--max-turns ${maxTurns}`,
    '--permission-mode dontAsk',
    `--settings ${quote(await runSettings($, run.wt))}`,
    ...(pluginDir ? [`--plugin-dir ${quote(pluginDir)}`] : []),
    `> ${quote(`${cacheOf(run)}/worker.json`)} 2> ${quote(`${cacheOf(run)}/worker.err`)}`,
  ].join(' ')
}

async function worker($: Engine, resume?: string) {
  let state = await loadState($)
  if (!state.run) {
    const status = await git($, ['status', '--porcelain'])
    if (!status.ok) return fail(status.out)
    if (status.out) return fail('the working tree is not clean; commit or stash first')
    const list = await $.fs.exists(`${S.root}/${FEATURES_PATH}`)
      ? parseFeatures(await $.fs.read(`${S.root}/${FEATURES_PATH}`))
      : `${FEATURES_PATH} is missing; run /slice:shape first`
    if (typeof list === 'string') return fail(list)
    const [head, branch] = [await git($, ['rev-parse', 'HEAD']), await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])]
    if (!head.ok || !branch.ok) return fail(head.out || branch.out)
    if (branch.out === 'HEAD') return fail('HEAD is detached; check out a branch first')
    const t0 = await $.clock.now()
    const name = `slice/run-${stamp(t0)}`
    const wt = `${await cacheDir($)}/run`
    const added = await git($, ['worktree', 'add', '-b', name, wt, 'HEAD'])
    if (!added.ok) return fail(added.out)
    const run: Run = {
      branch: name, base: head.out, baseBranch: branch.out, wt, t0, costUsd: 0, sessionCosts: {}, resumes: 0, stalls: 0,
      lastPassed: countPassed(list), sessionId: '', last: 'started',
    }
    state = { ...state, run }
    await saveState($, state)
    await logEvent($, 'run-start', { branch: name, base: head.out, total: list.features.length })
  }
  const run = state.run!
  const sessionId = resume ?? run.sessionId
  return text({ cwd: run.wt, command: await workerCommand($, run, sessionId || undefined) })
}

function parseOut(raw: string): Out | null {
  for (const line of raw.trim().split('\n').reverse()) {
    if (!line.trim().startsWith('{')) continue
    try {
      const out = JSON.parse(line)
      if (out && typeof out === 'object') return out as Out
    } catch { /* not the result line */ }
  }
  return null
}

function decide(out: Out | null, passed: number, total: number, run: Run): Step & { stalls: number } {
  const progress = passed > run.lastPassed
  const ok = out?.subtype === 'success' && !out.is_error
  if (ok && passed === total) return { action: 'finish', reason: 'all features pass', stalls: 0 }
  const why = !out ? 'the builder produced no result' : ok ? 'features remain' : (out.subtype ?? 'error')
  const stalls = progress ? 0 : run.stalls
  const limit = ok ? 1 : MAX_STALLS
  if (stalls >= limit) {
    return { action: 'halt', reason: `${why}; ${stalls} resumes in a row brought no new passing feature`, stalls }
  }
  if (!out?.session_id && !run.sessionId) return { action: 'halt', reason: `${why}; no session to resume`, stalls }
  return { action: 'resume', reason: `${why}; ${total - passed} of ${total} remain`, stalls: progress ? 0 : stalls + 1 }
}

async function check($: Engine) {
  const state = await loadState($)
  const run = state.run
  if (!run) return fail('no active run; call worker first')
  const file = `${cacheOf(run)}/worker.json`
  const out = parseOut((await $.fs.exists(file)) ? await $.fs.read(file) : '')
  const sessionId = out?.session_id ?? run.sessionId
  const sessionCosts = { ...run.sessionCosts }
  if (out?.session_id && typeof out.total_cost_usd === 'number') sessionCosts[out.session_id] = out.total_cost_usd
  const costUsd = Object.values(sessionCosts).reduce((a, b) => a + b, 0)
  const now = await readFeatures($, run)
  const base = await git($, ['show', `${run.base}:${FEATURES_PATH}`])
  let step: Step & { stalls: number }
  let [passed, total] = [run.lastPassed, 0]
  if (typeof now === 'string') {
    step = { action: 'halt', reason: now, stalls: run.stalls }
  } else {
    ;[passed, total] = [countPassed(now), now.features.length]
    const intact = base.ok && onlyPassesChanged(base.out, await $.fs.read(`${run.wt}/${FEATURES_PATH}`))
    step = intact
      ? decide(out, passed, total, { ...run, sessionId })
      : { action: 'halt', reason: 'feature list changed beyond passes', stalls: run.stalls }
  }
  const resumes = run.resumes + (step.action === 'resume' ? 1 : 0)
  const last = `${step.action}: ${step.reason}`
  const next: Run = { ...run, costUsd, sessionCosts, sessionId, lastPassed: passed, stalls: step.stalls, resumes, last }
  await saveState($, { ...state, run: next })
  await logEvent($, 'check', {
    action: step.action, reason: step.reason, passed, total, costUsd, subtype: out?.subtype, turns: out?.num_turns,
    terminal: out?.terminal_reason,
  })
  if (step.action === 'halt') await notify($, `slice run halted: ${step.reason}`)
  return text({ action: step.action, reason: step.reason, session_id: sessionId, passed, total, costUsd })
}

function body(list: FeatureList, run: Run): string {
  const rows = list.features.map(f => `- [${f.passes ? 'x' : ' '}] ${f.id} ${f.title}`)
  const intro = `Built unattended by slice on \`${run.branch}\`.`
  return [intro, '', ...rows, '', `Cost: $${run.costUsd.toFixed(2)}`].join('\n')
}

async function publish($: Engine, run: Run, list: FeatureList, mode: EndMode): Promise<Cmd & { prs: string[] }> {
  const pr = (base: string, head: string, title: string, bodyText: string) =>
    cmd($, ['gh', 'pr', 'create', '--draft', '--base', base, '--head', head, '--title', title, '--body', bodyText])
  if (mode === 'pr') {
    const pushed = await git($, ['push', '-u', 'origin', run.branch])
    if (!pushed.ok) return { ...pushed, prs: [] }
    const made = await pr(run.baseBranch, run.branch, `slice: ${run.branch}`, body(list, run))
    return { ...made, prs: made.ok ? [made.out] : [] }
  }
  const log = await git($, ['log', '--reverse', '--format=%H%x09%s', `${run.base}..${run.branch}`])
  if (!log.ok) return { ...log, prs: [] }
  const isFeature = (s?: string) => !!s?.startsWith('slice: ') && s !== 'slice: plan'
  const commits = log.out.split('\n').map(l => l.split('\t')).filter(([, s]) => isFeature(s))
  if (commits.length === 0) return { ok: false, out: 'no commit with a "slice: " subject on the run branch', prs: [] }
  const prs: string[] = []
  let base = run.baseBranch
  for (const [sha, subject] of commits) {
    const id = subject!.split(' ')[1]!
    const head = `slice/${id}`
    for (const step of [['branch', '-f', head, sha!], ['push', '-u', 'origin', head]]) {
      const r = await git($, step)
      if (!r.ok) return { ...r, prs }
    }
    const made = await pr(base, head, subject!, body(list, run))
    if (!made.ok) return { ...made, prs }
    prs.push(made.out)
    base = head
  }
  return { ok: true, out: '', prs }
}

async function finish($: Engine, mode: string) {
  const state = await loadState($)
  const run = state.run
  if (!run) return fail('no active run')
  if (!END_MODES.includes(mode as EndMode)) return fail(`mode must be one of ${END_MODES.join(', ')}`)
  const list = await readFeatures($, run)
  if (typeof list === 'string') return fail(list)
  let summary = `kept branch ${run.branch}`
  if (mode === 'merge') {
    const dirty = await git($, ['status', '--porcelain'])
    const current = await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])
    if (!dirty.ok || dirty.out) return fail(`the main checkout is not clean; ${dirty.out || 'commit or stash first'}`)
    if (current.out !== run.baseBranch) return fail(`the main checkout is on ${current.out}, not ${run.baseBranch}`)
    const merged = await git($, ['merge', '--no-ff', '-m', `slice: merge ${run.branch}`, run.branch])
    if (!merged.ok) {
      await git($, ['merge', '--abort'])
      return fail(merged.out)
    }
    summary = `merged ${run.branch} into ${run.baseBranch}`
  } else if (mode !== 'branch') {
    const done = await publish($, run, list, mode as EndMode)
    if (!done.ok) return fail(`${done.out}${done.prs.length ? `\nopened so far: ${done.prs.join(' ')}` : ''}`)
    summary = `opened draft PRs: ${done.prs.join(' ')}`
  }
  let removed = await git($, ['worktree', 'remove', '--force', run.wt])
  if (!removed.ok && !(await $.fs.exists(run.wt))) removed = await git($, ['worktree', 'prune'])
  if (!removed.ok) return fail(`${summary}, but the worktree stays: ${removed.out}`)
  await saveState($, { ...state, run: undefined })
  const passed = countPassed(list)
  const message = `${summary} (${passed}/${list.features.length} passed, $${run.costUsd.toFixed(2)})`
  await logEvent($, 'run-finish', { mode, passed, total: list.features.length, costUsd: run.costUsd })
  await notify($, `slice run finished: ${message}`)
  return text(message)
}
