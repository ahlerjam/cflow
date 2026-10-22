import { atom, read, update } from 'claude-code'

import type { ActJob, ActRunDetail, ActView, ActWorkflow, CiFleet, CiRun, CiSnapshot, GhProblem } from '../types'
import { LOG_LINES_STEP, RUN_DETAIL_FIELDS, WORKFLOW_FIELDS, demoRunDetail, logPrompt, parseLog, parseRunDetail, parseWorkflows, runEndText } from './actions'
import { demoCi } from './demo-data'
import { PR_FIELDS, REPO_NAME, RUN_FIELDS, RUN_LIMIT, ago, parseFleet, parsePool, parsePr, parseRuns, qualifyRepo, queuedTooLong, runPrompt } from './ci'
import { currentBranch, currentRepo, ghPath, ghReady, hostOs, note, resolveOwner, runGh, setSetting, showStatus, toast } from './core'
import type { RepoId } from './core'
import { t } from './i18n'
import type { RunnerPool } from './sources'
import { ALL_REPOS_FETCH, ALL_REPOS_SHOWN, HEALTH_EVERY_MS, OWNER_CACHE_MS, PANE, REMEMBER_MAX, S, normalizeTab } from './state'
import type { Eng } from './state'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of the file itself.
const actAllA = atom({ plugin: 'cockpit', key: 'actAllRepos' } as const, false)
const actJobA = atom({ plugin: 'cockpit', key: 'actJob' } as const, 0)
const actLogA = atom({ plugin: 'cockpit', key: 'actLog' } as const, null)
const actLogLimitA = atom({ plugin: 'cockpit', key: 'actLogLimit' } as const, 60)
const actOpenA = atom({ plugin: 'cockpit', key: 'actOpen' } as const, null)
const actRunA = atom({ plugin: 'cockpit', key: 'actRun' } as const, null)
const actStepA = atom({ plugin: 'cockpit', key: 'actStep' } as const, '')
const actViewA = atom({ plugin: 'cockpit', key: 'actView' } as const, 'runs')
const actWfA = atom({ plugin: 'cockpit', key: 'actWorkflows' } as const, null)
const actWfFilterA = atom({ plugin: 'cockpit', key: 'actWorkflowFilter' } as const, '')
const ciA = atom({ plugin: 'cockpit', key: 'ci' } as const, null)
const confirmA = atom({ plugin: 'cockpit', key: 'confirm' } as const, '')
const tabA = atom({ plugin: 'cockpit', key: 'tab' } as const, 'sources')

const emptySnap = (now: number): CiSnapshot => ({
  at: now, pool: null, poolAt: 0, poolError: null, repo: null, pr: null, runs: [], ghError: null, repoErrors: {}, problem: null, retryAt: 0,
  fleet: null, fleetError: null, isDemo: false,
})

const poolConfig = (): RunnerPool | undefined => S.cfg.settings.runnerPool

// Pool card, Runner sub-tab and VM list exist for a configured pool; the demo shows sample data for them
export const hasPoolUi = (): boolean => poolConfig() !== undefined || S.cfg.settings.demo

async function isPaneUp($: Eng): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
}

// A second call during a run attaches to it
function once(kind: string, run: () => Promise<void>): Promise<void> {
  const running = S.inflight.get(kind)
  if (running) return running
  const started = run().finally(() => S.inflight.delete(kind))
  S.inflight.set(kind, started)
  return started
}

function remember<T>(set: Set<T>, value: T, max = REMEMBER_MAX): void {
  set.add(value)
  while (set.size > max) {
    const oldest = set.values().next()
    if (oldest.done) break
    set.delete(oldest.value)
  }
}

// The expensive queries are only worth it while the Actions tab is visible
export async function isActionsVisible($: Eng): Promise<boolean> {
  if (normalizeTab(await read($, tabA)) !== 'actions') return false
  return isPaneUp($)
}

// Timer: the light poll always (status line, notifications); the heavy part after the pane was opened once
// and only while the Actions tab is visible. During a rate limit backoff the tick does nothing.
export async function refreshCiAuto($: Eng): Promise<void> {
  if ((await $.clock.now()) < S.rateUntil) return
  await refreshLight($)
  if (S.hasOpenedPane && (await isActionsVisible($))) await refreshHeavy($)
}

export async function refreshCi($: Eng, isFull = true): Promise<void> {
  await refreshLight($)
  if (isFull) await refreshHeavy($)
}

function alertQueued($: Eng, runs: readonly CiRun[], now: number): void {
  for (const r of queuedTooLong(runs, now, S.cfg.settings.queuedAlertMin)) {
    if (S.alerted.has(r.id)) continue
    remember(S.alerted, r.id)
    toast($, t('ci.queuedAlert', { name: t('common.quote', { text: r.name }), age: ago(r.createdAt, now) }))
  }
}

// Runs of the current branch that ended: those seen queued or running, and those created after the first poll of
// the session (a short run can start and end between two polls). Each attempt is announced once.
async function announceRunEnds($: Eng, here: RepoId, runs: readonly CiRun[], now: number): Promise<void> {
  if (S.firstPollAt === 0) S.firstPollAt = now
  if (!S.cfg.settings.notifyRunEnd) return
  const branch = await currentBranch($, here.root)
  if (!branch) return
  for (const r of runs) {
    if (r.branch !== branch) continue
    const key = `${r.id}:${r.attempt ?? 1}`
    if (r.status !== 'completed') {
      remember(S.watched, key)
      continue
    }
    const isNew = Date.parse(r.createdAt) > S.firstPollAt
    if (!(S.watched.has(key) || isNew) || S.notified.has(key)) continue
    S.watched.delete(key)
    remember(S.notified, key)
    const text = runEndText(r.name, r.branch, r.conclusion, Date.parse(r.updatedAt) - Date.parse(r.startedAt || r.createdAt))
    if (!text) continue
    try {
      const sent = await $.ui.notify(text, { title: 'Cockpit' })
      if (!sent.isSent) toast($, text)
    } catch {
      toast($, text)
    }
  }
}

// PR and runs of the current repo: feeds the status line, the alerts and the run-end notifications
export function refreshLight($: Eng): Promise<void> {
  return once('light', async () => {
    const now = await $.clock.now()
    const here = await currentRepo($)
    const ready = await ghReady($)
    const isAll = (await read($, actAllA)) || !here
    const patch: Partial<CiSnapshot> = { at: now, repo: here?.full ?? null, pr: null, ghError: null }
    let problem: GhProblem | null = ready.problem ?? (here ? null : 'noRepo')
    if (ready.bin && here) {
      try {
        const pr = await runGh($, ready.bin, ['pr', 'view', '--json', PR_FIELDS], { cwd: here.root, timeoutMs: 20_000 })
        if (pr.exitCode === 0) patch.pr = parsePr(pr.stdout)
      } catch {
        // no PR for this branch
      }
      let runs: CiRun[] = []
      let error: string | null = null
      try {
        const loaded = await loadRuns($, ready.bin, [here.full])
        runs = loaded.runs
        error = loaded.error
      } catch (err) {
        error = String(err).slice(0, 160)
      }
      if (!isAll) {
        patch.runs = runs
        patch.repoErrors = {}
        patch.ghError = error
      }
      if (!error) {
        await announceRunEnds($, here, runs, now)
        alertQueued($, runs, now)
      }
    }
    if (isAll) delete patch.ghError
    if (patch.pr) {
      const { number, checks } = patch.pr
      if (checks.failed > (S.lastFailed.get(number) ?? 0)) toast($, t('ci.prFailed', { number, n: checks.failed }))
      S.lastFailed.delete(number)
      S.lastFailed.set(number, checks.failed)
      if (S.lastFailed.size > 50) S.lastFailed.delete(S.lastFailed.keys().next().value ?? 0)
    }
    if (!problem && S.rateUntil > now) problem = 'rate'
    patch.problem = problem
    patch.retryAt = problem === 'rate' ? S.rateUntil : 0
    await update($, ciA, v => ({ ...(v ?? emptySnap(now)), ...patch }))
    await showStatus($)
  })
}

// All-repos list, pool health and VM list
export function refreshHeavy($: Eng): Promise<void> {
  return once('heavy', async () => {
    const now = await $.clock.now()
    const here = await currentRepo($)
    const ready = await ghReady($)
    const before = await read($, ciA)
    const patch: Partial<CiSnapshot> = { isDemo: false }
    if (ready.bin && ((await read($, actAllA)) || !here)) {
      try {
        const repos = await reposForAll($, ready.bin)
        const loaded = await loadRuns($, ready.bin, repos)
        patch.runs = loaded.runs
        patch.repoErrors = loaded.errors
        patch.ghError = loaded.error
        alertQueued($, loaded.runs, now)
      } catch (err) {
        patch.ghError = String(err).slice(0, 160)
        patch.repoErrors = {}
      }
    }
    const pool = poolConfig()
    if (S.cfg.settings.demo) {
      const demo = demoCi(now)
      Object.assign(patch, { fleet: demo.fleet, fleetError: null, isDemo: true })
      if (!pool) Object.assign(patch, { pool: demo.pool, poolAt: now, poolError: null })
    } else if (!pool) {
      Object.assign(patch, { pool: null, poolAt: 0, poolError: null, fleet: null, fleetError: null })
    }
    if (pool) {
      Object.assign(patch, await fetchHealth($, pool, before, now))
      if (!S.cfg.settings.demo) Object.assign(patch, await loadFleet($, pool, ready.bin))
    }
    if (S.rateUntil > now) Object.assign(patch, { problem: 'rate', retryAt: S.rateUntil })
    await update($, ciA, v => ({ ...(v ?? emptySnap(now)), ...patch }))
  })
}

async function fetchHealth($: Eng, pool: RunnerPool, before: CiSnapshot | null, now: number): Promise<Pick<CiSnapshot, 'pool' | 'poolAt' | 'poolError'>> {
  const kept = { pool: before?.pool ?? null, poolAt: before?.poolAt ?? 0 }
  try {
    const res = await $.http.fetch(pool.healthUrl)
    if (res.ok) return { pool: parsePool(res.text), poolAt: now, poolError: null }
    return { ...kept, poolError: `HTTP ${res.status}` }
  } catch (err) {
    return { ...kept, poolError: String(err).slice(0, 120) }
  }
}

const TOKEN_RETRY_MS = 300_000
// A command like `op read` may wait for a fingerprint
const TOKEN_TIMEOUT_MS = 30_000
const TOKEN_SHAPE = /^[\x21-\x7e]{1,4096}$/

// Read once per session: the token only ever lives in memory and is not logged. A failed read is not kept:
// the next try comes after TOKEN_RETRY_MS.
async function poolToken($: Eng, pool: RunnerPool): Promise<string> {
  if (S.poolToken) return S.poolToken
  const now = await $.clock.now()
  if (S.poolTokenFailedAt > 0 && now - S.poolTokenFailedAt < TOKEN_RETRY_MS) return ''
  let token = ''
  const spec = pool.token
  try {
    if (spec && 'command' in spec) {
      const res = await $.process.run(spec.command, { timeoutMs: TOKEN_TIMEOUT_MS })
      if (res.exitCode === 0) token = res.stdout.trim()
    } else if (spec && (await hostOs($)) !== 'windows') {
      // $.env.get needs a literal name, so a configurable variable is read through printenv
      const res = await $.process.run(['printenv', spec.env], { timeoutMs: TOKEN_TIMEOUT_MS })
      if (res.exitCode === 0) token = res.stdout.trim()
    }
  } catch {
    // no token
  }
  if (TOKEN_SHAPE.test(token)) {
    S.poolToken = token
    S.poolTokenFailedAt = 0
    return token
  }
  S.poolTokenFailedAt = now
  return ''
}

const qualified = (repo: unknown, owner: string): string => {
  const full = typeof repo === 'string' ? qualifyRepo(repo, owner) : ''
  return REPO_NAME.test(full) ? full : ''
}

const DIGITS = /^\d+$/

const isRunRef = (repo: string, runId: number): boolean => REPO_NAME.test(repo) && Number.isInteger(runId) && runId > 0

// VM list from the pool (GET vmsUrl), job names and links from GitHub
async function loadFleet($: Eng, pool: RunnerPool, bin: string | null): Promise<{ fleet: CiFleet | null; fleetError: string | null }> {
  if (!pool.vmsUrl) return { fleet: null, fleetError: null }
  const headers: Record<string, string> = {}
  if (pool.token) {
    const token = await poolToken($, pool)
    if (!token) return { fleet: null, fleetError: t('ci.tokenMissing') }
    headers['Authorization'] = `Bearer ${token}`
  }
  let fleet: CiFleet
  try {
    const res = await $.http.fetch(pool.vmsUrl, { headers })
    if (!res.ok) return { fleet: null, fleetError: res.status === 404 ? t('ci.vmsUnknown') : t('ci.vmsHttp', { status: res.status }) }
    fleet = parseFleet(res.text, pool)
  } catch (err) {
    return { fleet: null, fleetError: t('ci.vmsError', { error: String(err).slice(0, 120) }) }
  }
  const owner = pool.owner ?? (bin ? await resolveOwner($, bin) : null) ?? ''
  // The pool is remote data: a repo that is not owner/name never reaches a gh call
  fleet = { ...fleet, vms: fleet.vms.map(v => ({ ...v, repo: qualified(v.repo, owner) })) }
  if (!bin) return { fleet, fleetError: null }
  const busyRepos = [...new Set(fleet.vms.filter(v => v.state !== 'ready' && v.repo !== '').map(v => v.repo))]
  const jobOf = new Map<string, { name: string; url: string; runId: number; jobId: number; repo: string }>()
  for (const repo of busyRepos.slice(0, 6)) {
    try {
      const runs = await runGh($, bin, ['api', `repos/${repo}/actions/runs?status=in_progress&per_page=10`, '--jq', '.workflow_runs[].id'], { timeoutMs: 15_000 })
      for (const id of runs.stdout.split('\n').filter(l => DIGITS.test(l)).slice(0, 5)) {
        const jobs = await runGh(
          $, bin,
          ['api', `repos/${repo}/actions/runs/${id}/jobs`, '--jq', '.jobs[] | select(.runner_name != null) | [.runner_name, .name, .html_url, (.run_id|tostring), (.id|tostring)] | @tsv'],
          { timeoutMs: 15_000 },
        )
        for (const line of jobs.stdout.split('\n')) {
          const [runner, name, url, runId, jobId] = line.split('\t')
          if (runner && name && DIGITS.test(runId ?? '') && DIGITS.test(jobId ?? '')) jobOf.set(runner, { name, url: url ?? '', runId: Number(runId), jobId: Number(jobId), repo })
        }
      }
    } catch {
      // Job names are optional; the list stays valid without them
    }
  }
  return {
    fleet: {
      ...fleet,
      vms: fleet.vms.map(v => {
        const j = jobOf.get(v.name)
        return { ...v, job: j?.name ?? null, jobUrl: j?.url || null, runId: j?.runId ?? 0, jobId: j?.jobId ?? 0 }
      }),
    },
    fleetError: null,
  }
}

export function startCiTimer($: Eng): void {
  S.ciTimer?.cancel()
  S.ciTimer = null
  S.healthTimer?.cancel()
  S.healthTimer = null
  if (!S.isInteractive) return
  // /health is a single cheap request: every minute, independent of the CI interval
  if (poolConfig()) S.healthTimer = $.clock.every(HEALTH_EVERY_MS, () => void refreshHealth($))
  if (S.cfg.settings.ciEverySec <= 0) return
  S.ciTimer = $.clock.every(S.cfg.settings.ciEverySec * 1000, () => void refreshCiAuto($))
}

// Between the heavy refreshes: while the pane is open, the pool health keeps moving
export function refreshHealth($: Eng): Promise<void> {
  const pool = poolConfig()
  if (!pool || !S.hasOpenedPane) return Promise.resolve()
  return once('health', async () => {
    if (!(await isPaneUp($))) return
    const now = await $.clock.now()
    const health = await fetchHealth($, pool, await read($, ciA), now)
    await update($, ciA, v => ({ ...(v ?? emptySnap(now)), ...health }))
  })
}

export async function setCiInterval($: Eng, sec: number): Promise<void> {
  await setSetting($, 'ciEverySec', sec)
  startCiTimer($)
  if (sec > 0) void refreshCi($)
}

// The most recently active repos of the owner, for "All repos"; throws with gh's message
export async function reposForAll($: Eng, bin: string): Promise<string[]> {
  const owner = await resolveOwner($, bin)
  if (!owner) return []
  const now = await $.clock.now()
  if (S.allRepos.length && S.allReposOwner === owner && now - S.allReposAt < OWNER_CACHE_MS) return S.allRepos
  const res = await runGh($, bin, ['repo', 'list', owner, '--limit', String(ALL_REPOS_FETCH), '--no-archived', '--json', 'nameWithOwner,pushedAt'], { timeoutMs: 20_000 })
  if (res.exitCode !== 0) throw new Error(res.stderr.trim().slice(0, 160))
  const rows = JSON.parse(res.stdout) as Array<{ nameWithOwner: string; pushedAt: string }>
  S.allRepos = rows
    .sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))
    .slice(0, ALL_REPOS_SHOWN)
    .map(r => r.nameWithOwner)
  S.allReposOwner = owner
  S.allReposAt = now
  return S.allRepos
}

// A failing repo is recorded under its name; `error` is only set when every repo failed
export async function loadRuns($: Eng, bin: string, repos: readonly string[]): Promise<{ runs: CiRun[]; errors: Record<string, string>; error: string | null }> {
  const runs: CiRun[] = []
  const errors: Record<string, string> = {}
  for (const repo of repos) {
    const res = await runGh($, bin, ['run', 'list', '-R', repo, '-L', String(RUN_LIMIT), '--json', RUN_FIELDS], { timeoutMs: 20_000 })
    if (res.exitCode === 0) runs.push(...parseRuns(res.stdout, repo))
    else errors[repo] = res.stderr.trim().slice(0, 160) || `exit ${res.exitCode}`
  }
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const failed = Object.values(errors)
  return { runs: runs.slice(0, RUN_LIMIT), errors, error: repos.length > 0 && failed.length === repos.length ? (failed[0] ?? null) : null }
}

export async function showActView($: Eng, view: ActView): Promise<void> {
  await update($, actViewA, () => view)
  await update($, actOpenA, () => null)
  await update($, actLogA, () => null)
  if (view === 'workflows') void loadWorkflows($)
}

export async function toggleAllRepos($: Eng): Promise<void> {
  await update($, actAllA, v => !v)
  await refreshCi($)
}

export async function openRun($: Eng, repo: string, runId: number, jobId = 0): Promise<void> {
  if (!isRunRef(repo, runId)) {
    toast($, t('act.badRun'))
    return
  }
  await update($, actOpenA, () => ({ repo, runId, jobId }))
  await update($, actRunA, () => null)
  await update($, actLogA, () => null)
  await update($, confirmA, () => '')
  let detail: ActRunDetail
  const ci = await read($, ciA)
  const vm = ci?.fleet?.vms.find(v => v.runId === runId)
  if (ci?.isDemo && vm) {
    detail = demoRunDetail(repo, runId, vm.job ?? t('act.jobFallback'), await $.clock.now())
  } else {
    const bin = await ghPath($)
    if (!bin) return
    const res = await $.process.run([bin, 'run', 'view', String(runId), '-R', repo, '--json', RUN_DETAIL_FIELDS], { timeoutMs: 20_000 })
    if (res.exitCode !== 0) {
      await note($, t('act.runError', { id: runId, error: res.stderr.trim().slice(0, 140) }))
      return
    }
    detail = parseRunDetail(repo, res.stdout)
  }
  const pick =
    detail.jobs.find(j => j.id === jobId) ??
    detail.jobs.find(j => j.conclusion === 'failure') ??
    detail.jobs.find(j => j.status !== 'completed') ??
    detail.jobs[0]
  await update($, actJobA, () => pick?.id ?? 0)
  await update($, actRunA, () => detail)
}

export async function closeRun($: Eng): Promise<void> {
  await update($, actOpenA, () => null)
  await update($, actRunA, () => null)
  await update($, actLogA, () => null)
}

export async function toggleJob($: Eng, id: number): Promise<void> {
  await update($, actJobA, v => (v === id ? 0 : id))
}

export async function openLog($: Eng, job: ActJob, stepName = ''): Promise<void> {
  const run = await read($, actRunA)
  if (!run) return
  const base = { repo: run.repo, jobId: job.id, jobName: job.name, isFailedOnly: false }
  await update($, actLogLimitA, () => LOG_LINES_STEP)
  if (run.isDemo) {
    // Sample output, not localized
    const lines = ['▸ Run pytest -q', 'collected 412 items', '....................................... [ 40%]', '....................F.................. [ 80%]', 'FAILED tests/test_routes.py::test_multiday - TimeoutError', 'error: 1 failed, 411 passed in 312.4s']
    await update($, actLogA, () => ({ ...base, steps: [{ name: stepName || job.steps.at(-1)?.name || t('act.logStep'), lines }], error: null }))
    await update($, actStepA, () => stepName || job.steps.at(-1)?.name || t('act.logStep'))
    return
  }
  if (job.status !== 'completed') {
    await update($, actLogA, () => ({
      ...base,
      steps: [],
      error: t('act.logAfterJob'),
    }))
    return
  }
  const bin = await ghPath($)
  if (!bin) return
  await update($, actLogA, () => ({ ...base, steps: [], error: null }))
  const res = await $.process.run([bin, 'run', 'view', '-R', run.repo, '--job', String(job.id), '--log'], { timeoutMs: 30_000 })
  if (res.exitCode !== 0) {
    await update($, actLogA, () => ({ ...base, steps: [], error: res.stderr.trim().slice(0, 160) }))
    return
  }
  const steps = parseLog(res.stdout, job.steps)
  const failed = job.steps.find(s => s.conclusion === 'failure')?.name
  const first = stepName || (failed && steps.some(s => s.name === failed) ? failed : steps.at(-1)?.name) || ''
  await update($, actStepA, () => first)
  await update($, actLogA, () => ({ ...base, steps, error: res.isStdoutTruncated ? t('act.logTruncated') : null }))
}

export async function closeLog($: Eng): Promise<void> {
  await update($, actLogA, () => null)
}

export async function runAction($: Eng, run: ActRunDetail, action: 'rerun-failed' | 'rerun' | 'cancel'): Promise<void> {
  if (run.isDemo) {
    toast($, t('act.demoNoAction'))
    return
  }
  const bin = await ghPath($)
  if (!bin) return
  const argv =
    action === 'cancel'
      ? [bin, 'run', 'cancel', String(run.id), '-R', run.repo]
      : [bin, 'run', 'rerun', String(run.id), '-R', run.repo, ...(action === 'rerun-failed' ? ['--failed'] : [])]
  const res = await $.process.run(argv, { timeoutMs: 30_000 })
  if (res.exitCode === 0) toast($, t(action === 'cancel' ? 'act.cancelledToast' : 'act.restartedToast', { name: t('common.quote', { text: run.workflow }) }))
  else await note($, `${run.workflow}: ${res.stderr.trim().slice(0, 160)}`)
  await openRun($, run.repo, run.id)
  void refreshCi($)
}

export async function analyzeLog($: Eng): Promise<void> {
  const run = await read($, actRunA)
  const log = await read($, actLogA)
  if (!run || !log || run.isDemo) {
    toast($, t('act.demoLog'))
    return
  }
  if (!isRunRef(run.repo, run.id)) {
    toast($, t('act.badRun'))
    return
  }
  toast($, t('act.logHanded', { name: t('common.quote', { text: log.jobName }) }))
  await $.prompt.submit({ text: logPrompt(log, run) })
}

export async function analyzeRunDetail($: Eng, run: ActRunDetail): Promise<void> {
  if (run.isDemo) {
    toast($, t('act.demoRunToClaude'))
    return
  }
  const asRun: CiRun = {
    repo: run.repo, id: run.id, name: run.workflow, status: run.status, conclusion: run.conclusion, branch: run.branch,
    createdAt: run.createdAt, startedAt: run.startedAt, updatedAt: run.updatedAt, url: run.url, attempt: run.attempt,
  }
  if (!isRunRef(run.repo, run.id)) {
    toast($, t('act.badRun'))
    return
  }
  toast($, t('act.runHanded', { name: t('common.quote', { text: run.workflow }) }))
  await $.prompt.submit({ text: runPrompt(run.repo, asRun) })
}

export async function loadWorkflows($: Eng): Promise<void> {
  const here = await currentRepo($)
  const bin = await ghPath($)
  const repo = here?.full ?? (bin ? (await reposForAll($, bin).catch(() => []))[0] : undefined)
  if (!bin || !repo) {
    await update($, actWfA, () => [])
    return
  }
  S.workflowRepo = repo
  const res = await runGh($, bin, ['workflow', 'list', '-R', repo, '--all', '--json', WORKFLOW_FIELDS], { timeoutMs: 20_000 })
  await update($, actWfA, () => (res.exitCode === 0 ? parseWorkflows(res.stdout) : []))
}

// Current branch of the repo root; for a detached HEAD or another repo its default branch, else gh decides
export async function dispatchWorkflow($: Eng, wf: ActWorkflow): Promise<void> {
  const bin = await ghPath($)
  const here = await currentRepo($)
  if (!bin || !S.workflowRepo) return
  let ref = here && here.full === S.workflowRepo ? await currentBranch($, here.root) : ''
  if (!ref) {
    const def = await runGh($, bin, ['repo', 'view', S.workflowRepo, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], { timeoutMs: 15_000 })
    if (def.exitCode === 0) ref = def.stdout.trim()
  }
  const res = await $.process.run([bin, 'workflow', 'run', String(wf.id), '-R', S.workflowRepo, ...(ref ? [`--ref=${ref}`] : [])], { timeoutMs: 20_000 })
  if (res.exitCode === 0) toast($, t('act.dispatched', { name: t('common.quote', { text: wf.name }), ref: ref || '–' }))
  else await note($, `${wf.name}: ${res.stderr.trim().slice(0, 160)}`)
  void refreshCi($)
}

export async function filterWorkflow($: Eng, name: string): Promise<void> {
  await update($, actWfFilterA, () => name)
  await showActView($, 'runs')
}
