import type { EngineInterface as Eng, On } from 'claude-code'
import { lockArgv } from './lock'
import { S, events, git, loadState, logEvent, saveState, type Kind, type Run, type Slice, type State } from './state'
import { shareDeps, wtRoot } from './flow'
import { proveAll } from './witness'
import { dispatch, pickUp, pushState } from './cloud'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const ORDER: Kind[] = ['bug', 'infra', 'tracer', 'feature', 'polish', 'consolidate']
export const OPTS = { runModel: 'opus', runEffort: 'high', fallbackModel: 'sonnet' }
const GB = 1024 * 1024
// A prompt cannot be submitted from a tool hook: these wait for the end of the turn
const LATER: string[] = []
const WATCHED = new Set<string>()

export const order = (q: Slice[]): Slice[] => [...q].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
// After the pilot page UI slices wait up to 4 h for the person; infra and backend go on
const STANDING: Kind[] = ['polish', 'consolidate']
// Polish waits for every other slice, consolidate also for polish; a stuck slice no longer blocks them
const blocked = (r: Run, y: Slice) => (y.after ?? []).some(d => ['stuck', 'rejected'].includes(r.queue.find(z => z.id === d)?.status ?? ''))
const settled = (r: Run, x: Slice) => r.queue.every(y => y === x || ORDER.indexOf(y.kind) >= ORDER.indexOf(x.kind) || ['merged', 'stuck', 'rejected'].includes(y.status) || blocked(r, y))
export const runnable = (r: Run, now = 0): Slice | undefined => r.queue.find(x => x.status === 'queued' && !(x.ui && (r.hold ?? 0) > now) && (!STANDING.includes(x.kind) || settled(r, x)) && (x.after ?? []).every(d => r.queue.find(y => y.id === d)?.status === 'merged'))
const open = (r: Run): boolean => r.queue.some(x => x.status === 'running' || x.status === 'cloud' || runnable(r) === x)

export function parseQueue(v: unknown): Run | string {
  const s = (v ?? {}) as Record<string, any>
  const slices = Array.isArray(s.slices) ? s.slices : []
  if (!/^[\w-]+$/.test(str(s.stage))) return 'stage needs an id of letters, digits, _ or -'
  if (!slices.length || slices.length > 15) return 'a stage has 1 to 15 slices'
  const ids = new Set<string>()
  for (const x of slices) {
    if (!/^[\w-]+$/.test(str(x.id)) || ids.has(x.id)) return `slice id ${x.id} is missing, malformed or twice`
    if (!ORDER.includes(x.kind) || !str(x.claim) || !str(x.brief)) return `slice ${x.id} needs kind (${ORDER.join(', ')}), claim and brief`
    ids.add(x.id)
  }
  const q: Slice[] = slices.map((x: any) => ({ id: x.id, kind: x.kind, claim: x.claim, brief: x.brief, proof: str(x.proof) || 'make verify', risk: ['low', 'medium', 'high'].includes(x.risk) ? x.risk : 'medium', after: (x.after ?? []).filter((d: string) => ids.has(d)), cloud: !!x.cloud, ui: !!x.ui, status: 'queued' }))
  return { stage: s.stage, branch: `slice/${s.stage}`, wt: '', t0: 0, maxHours: Number(s.maxHours) || 48, budget: Number(s.budget) || 30, use0: 0, queue: order(q), added: 0, pilot: true, pages: 0, online: s.online !== false }
}

async function limit($: Eng, kind: string) { return (await $.session.usage()).rateLimits.find(l => l.kind === kind) }
async function freeKb($: Eng, path: string) { return Number((await $.process.run(['sh', '-c', 'df -Pk "$1" | awk \'NR==2{print $4}\'', 'sh', path])).stdout.trim()) || Infinity }
async function duKb($: Eng, path: string) { return Number((await $.process.run(['sh', '-c', 'du -sk "$1" 2>/dev/null | cut -f1', 'sh', path])).stdout.trim()) || 0 }

// Claude-Push has no mod API: the session itself sends it, so a hung session sends nothing
export async function notify($: Eng, text: string): Promise<void> {
  await logEvent($, 'notify', { text })
  try { await $.ui.notify(text, { title: 'slice' }) } catch {}
  if (S.isRun || !S.interactive) LATER.push(`Send one PushNotification with exactly this message and do nothing else: "slice ${text}"`)
}

export async function halt($: Eng, st: State, why: string): Promise<string> {
  await saveState($, { ...st, run: { ...st.run!, halt: why } })
  await notify($, `${st.run!.stage}: halt, ${why}`)
  return `halted: ${why}`
}

// The exits, checked at every slice boundary; a limit near its end is a pause, not a halt
export async function exits($: Eng, st: State): Promise<{ halt?: string; wait?: string }> {
  const r = st.run!
  const [now, five, week, spend] = [await $.clock.now(), await limit($, 'five_hour'), await limit($, 'seven_day'), await limit($, 'spend_limit')]
  if (spend && spend.percentUsed >= 100) return { halt: 'spend or credit limit reached' }
  if (now - r.t0 > r.maxHours * 36e5) return { halt: `wall-clock ${r.maxHours} h passed` }
  if ((await freeKb($, S.root)) < 20 * GB) return { halt: 'less than 20 GB free disk' }
  if (week && week.percentUsed >= 70) return { halt: '7-day reserve: 70 % of the weekly limit used' }
  if (week && week.percentUsed - r.use0 > 3 * r.budget) return { halt: `three times the stage budget (${r.budget} % of the weekly limit) used` }
  if (five && five.percentUsed >= 90) return { wait: five.resetsAt ?? '' }
  return {}
}

export const slicePrompt = (r: Run, x: Slice): string => `slice run ${r.stage}, slice ${x.id}. Start the plugin workflow slice:feature (the Workflow tool, or the Skill tool with slice:feature) with args ${JSON.stringify({ id: x.id, claim: x.claim, brief: x.brief, proof: x.proof, risk: x.risk, kind: x.kind, ui: x.ui, base: r.branch, built: !!x.why?.includes('built in the cloud') })}. When it returns verified, call the slice tool with action merge and id ${x.id}; when it returns stuck, call merge with id ${x.id} and text set to its question. Never commit, push or open a PR yourself.`

async function spawnSlice($: Eng, st: State, x: Slice): Promise<string> {
  const r = st.run!
  const n = r.queue.indexOf(x) + 1
  if (x.cloud && S.marker.cloud && !x.why?.includes('built in the cloud') && !(await $.env.get('SLICE_CLOUD'))) return dispatch($, st, x)
  // In a cloud run one nested session works the queue itself: it gets the next slice as its instruction
  if (await $.env.get('SLICE_CLOUD')) return (Object.assign(x, { status: 'running', t: await $.clock.now() }), await saveState($, st), (S.slice = x.id), await logEvent($, 'start', { slice: x.id }), `next: ${slicePrompt(r, x)}`)
  const prompt = slicePrompt(r, x)
  // A background session inherits neither the caller's env nor its --plugin-dir: both go in explicitly
  if (!(await $.fs.exists(`${S.dir}/run-settings.json`))) await writeSettings($)
  const base = JSON.parse(await $.fs.read(`${S.dir}/run-settings.json`))
  await $.fs.write(`${S.dir}/run-${x.id}.json`, JSON.stringify({ ...base, env: { ...base.env, SLICE_RUN: '1', SLICE_SLICE: x.id } }))
  const argv = ['claude', '--bg', '--name', `slice-${r.stage}-${n}`, '--plugin-dir', $.plugin.root, '--settings', `${S.dir}/run-${x.id}.json`, '--permission-mode', 'dontAsk', '--model', OPTS.runModel, '--effort', OPTS.runEffort, '--fallback-model', OPTS.fallbackModel, prompt]
  const p = await $.process.run(argv, { cwd: S.root, env: { SLICE_RUN: '1', SLICE_SLICE: x.id } })
  if (p.exitCode !== 0) return halt($, st, `could not start slice ${x.id}: ${p.stderr.trim().slice(0, 200)}`)
  x.status = x.cloud ? 'cloud' : 'running'
  x.t = await $.clock.now()
  await saveState($, st)
  return (await logEvent($, 'spawn', { slice: x.id, n }), `started slice ${x.id} (${n}/${r.queue.length})`)
}

// One slice boundary: exits, pause, pages, then the next session or the end of the run
export async function next($: Eng): Promise<string> {
  const st = await loadState($)
  if (!st?.run) return 'no run'
  const r = st.run
  if (r.stopped || r.halt) return r.halt ? `halted: ${r.halt}` : 'stopped'
  const merged = r.queue.filter(x => x.status === 'merged').length
  if (merged && (r.pilot ? merged === 2 : merged % 3 === 0) && r.pages < merged) {
    const kind = r.pilot && merged === 2 ? 'pilot' : 'progress'
    await proveAll($, r.wt)
    const page = await writePage($, st, kind)
    ;[r.pages, r.pilot] = [merged, false]
    if (kind === 'pilot') r.hold = (await $.clock.now()) + 4 * 36e5
    await saveState($, st), await notify($, `${r.stage}: ${merged}/${r.queue.length} merged, page ${page}`)
  }
  if (r.paused) return (await notify($, `${r.stage}: paused, /slice-resume continues`), 'paused')
  if (await pickUp($, st).catch(() => false)) return next($)
  const { halt: h, wait } = await exits($, st)
  if (h) return halt($, st, h)
  if (wait !== undefined) {
    await logEvent($, 'pause', { until: wait })
    if (S.isRun) LATER.push(`The 5-hour limit is above 90 %. Call CronCreate once for ${wait || 'the reset time of the 5-hour limit'} plus 2 minutes with the prompt /slice-resume, then end your turn.`)
    return (await notify($, `${r.stage}: paused at the 5-hour limit until ${wait || 'its reset'}; /slice-resume if it does not continue`), `paused until ${wait}`)
  }
  const now = await $.clock.now()
  const x = runnable(r, now)
  if (x) return spawnSlice($, st, x)
  if (runnable(r, Infinity) && (r.hold ?? 0) > now) {
    if (S.isRun) LATER.push(`UI slices wait for the person's look at the pilot page. Call CronCreate once at ${new Date(r.hold!).toISOString()} with the prompt /slice-resume, then end your turn.`)
    return 'UI slices wait up to 4 h for the pilot page'
  }
  if (open(r)) {
    if (S.isRun && r.queue.some(y => y.status === 'cloud')) LATER.push('Slices are building in the cloud. Call CronCreate once in 30 minutes with the prompt /slice-resume, then end your turn.')
    return 'waiting for running slices'
  }
  const stuck = r.queue.filter(y => y.status !== 'merged').map(y => y.id)
  await logEvent($, 'run-end', { merged, stuck })
  await pushState($, st, 'status').catch(() => undefined)
  await $.store.delete('active').catch(() => undefined)
  await notify($, `${r.stage}: run finished, ${merged} merged${stuck.length ? `, not merged: ${stuck.join(', ')}` : ''}; /slice:accept`)
  return 'run finished'
}
async function writeSettings($: Eng): Promise<void> {
  const profile = JSON.parse(await $.fs.read(`${$.plugin.root}/profiles/run.json`))
  const root = await wtRoot($)
  const sb = profile.sandbox
  sb.filesystem.allowWrite = [...sb.filesystem.allowWrite, root]
  sb.network.allowedDomains = [...sb.network.allowedDomains, ...(S.marker.allowedDomains ?? [])]
  sb.excludedCommands = [...(sb.excludedCommands ?? []), ...(S.marker.excludedCommands ?? [])]
  profile.permissions.additionalDirectories = [root]
  profile.permissions.allow = [...profile.permissions.allow, `Edit(/${root}/**)`, `Write(/${root}/**)`]
  await $.fs.write(`${S.dir}/run-settings.json`, JSON.stringify(profile, null, 2) + '\n')
}
async function start($: Eng, a: Record<string, unknown>): Promise<string> {
  const st = await loadState($)
  if (!st?.run) return 'Rejected: no approved queue. Fix: run /slice:shape first.'
  const active = (await $.store.get('active')) as { root: string; stage: string } | undefined
  if (active && active.root !== S.root) {
    const waiting = ((await $.store.get('waiting')) as string[] | undefined) ?? []
    await $.store.set('waiting', [...new Set([...waiting, S.root])])
    return `queued: ${active.stage} in ${active.root} is running; this run starts when it ends`
  }
  await $.store.set('active', { root: S.root, stage: st.run.stage })
  // A cloud clone may already have the run branch checked out: then the main checkout is the run worktree
  if (!(await $.fs.exists(st.run.wt))) st.run.wt = (await $.process.run(['git', '-C', S.root, 'symbolic-ref', '--short', 'HEAD'])).stdout.trim() === st.run.branch ? S.root : `${await wtRoot($)}/run/${st.run.stage}`
  if (!(await $.fs.exists(st.run.wt))) await git($, S.root, 'worktree', 'add', '-B', st.run.branch, st.run.wt, (await $.process.run(['git', '-C', S.root, 'rev-parse', '--verify', `origin/${st.run.branch}`])).exitCode === 0 ? `origin/${st.run.branch}` : 'HEAD')
  await shareDeps($, st.run.wt)
  st.run = { ...st.run, online: a.text !== 'offline', t0: st.run.t0 || (await $.clock.now()), use0: st.run.use0 || ((await limit($, 'seven_day'))?.percentUsed ?? 0) }
  if (!st.run.online) st.run.queue.forEach(x => !x.ui && x.kind !== 'consolidate' && (x.cloud = true))
  await saveState($, st), await writeSettings($), await logEvent($, 'run-start', { stage: st.run.stage })
  return next($)
}
async function queue($: Eng, a: Record<string, unknown>): Promise<string> {
  if (!S.interactive || S.isRun) return 'Refused: the queue is approved by the person in an interactive session.'
  const r = parseQueue(a.stage)
  if (typeof r === 'string') return `Rejected: ${r}.`
  const lines = r.queue.map((x, i) => `${i + 1}. ${x.kind} ${x.id} (${x.risk}${x.cloud ? ', cloud' : ''})`).join('\n')
  const scope = 'Run sessions may edit only their worktrees, run make check, verify, test-affected and verify-*, and use the slice tool; no commit, push or PR by Claude, no network beyond the allowlist.'
  if ((await $.ui.ask(`slice: approve stage ${r.stage}?\n${lines}\n${scope}`, ['Approve queue and scope', 'Cancel']).catch(() => '')) !== 'Approve queue and scope') return 'Not approved. Change the queue with the person, then queue again.'
  const wt = `${await wtRoot($)}/run/${r.stage}`
  if (!(await $.fs.exists(wt))) await git($, S.root, 'worktree', 'add', '-B', r.branch, wt, 'HEAD')
  await shareDeps($, wt)
  const st = (await loadState($)) ?? { startVersion: '', proofs: {}, misses: [] }
  await saveState($, { ...st, run: { ...r, wt } })
  if (S.marker.cloud) await git($, S.root, 'push', '-q', 'origin', `${r.branch}:${r.branch}`).then(() => pushState($, { ...st, run: { ...r, wt } }, 'queue')).catch(() => undefined)
  return (await logEvent($, 'queue', { stage: r.stage, n: r.queue.length }), `approved ${r.queue.length} slices on ${r.branch}; start with /slice:run`)
}
async function merge($: Eng, a: Record<string, unknown>, agentId?: string): Promise<string> {
  if (agentId) return 'Refused: only the run session merges.'
  const st = await loadState($)
  const x = st?.run?.queue.find(y => y.id === str(a.id))
  if (!st?.run || !x) return 'Rejected: no such slice in the run.'
  const ev = await events($)
  const wt = ev.filter(e => e.event === 'worktree' && e.id === x.id).at(-1)?.path as string | undefined
  if (str(a.text) || !wt) {
    Object.assign(x, { status: 'stuck', why: str(a.text) || 'no worktree' })
    return (await saveState($, st), await notify($, `${st.run.stage}: slice ${x.id} stuck`), `stuck ${x.id}: ${x.why}\n${await next($)}`)
  }
  const tree = await git($, wt, 'rev-parse', 'HEAD^{tree}')
  if (ev.filter(e => e.event === 'verdict' && e.tree === tree).at(-1)?.verdict !== 'pass') return `Refused: no verifier pass recorded on ${tree.slice(0, 10)}. Fix: finish /slice:feature first.`
  const run = st.run.wt
  await git($, run, 'merge', '--no-ff', '-q', `slice-${x.id}`, '-m', `slice: merge ${x.id}`)
  const check = await $.process.run(lockArgv(['make', 'check'], { interactive: false }), { cwd: run })
  const all = check.exitCode === 0 ? await proveAll($, run) : `FAIL make check\n${check.stderr.slice(-2000)}`
  if (!all.startsWith('all ')) {
    await git($, run, 'reset', '--hard', 'HEAD~1')
    const since = ev.filter(e => e.event === 'run-start').at(-1)?.t ?? 0
    const tries = ev.filter(e => e.event === 'merge-red' && e.slice === x.id && e.t >= since).length + 1
    await logEvent($, 'merge-red', { slice: x.id, tries, why: all.slice(0, 300) })
    Object.assign(x, tries < 2 ? { status: 'queued', why: `merge turned a proof red; rebuild on ${st.run.branch}` } : { status: 'stuck', why: all.slice(0, 300) })
    return (await saveState($, st), `reverted: the merge turned a proof red\n${all.slice(0, 600)}`)
  }
  const kb = await duKb($, wt)
  await $.process.run(['git', '-C', S.root, 'worktree', 'remove', '--force', wt])
  Object.assign(x, { status: 'merged', sha: await git($, run, 'rev-parse', 'HEAD'), disk: Math.round(kb / 1024) })
  await saveState($, st), await logEvent($, 'merged', { slice: x.id, sha: x.sha, mb: x.disk, result: all })
  await pushState($, st, 'status').catch(() => undefined)
  if (kb > 5 * GB) return halt($, st, `slice ${x.id} grew by more than 5 GB`)
  return `merged ${x.id}: ${all}\n${await next($)}`
}

// A run may add at most 30 % of its approved queue, each with a reason in the log
async function add($: Eng, a: Record<string, unknown>): Promise<string> {
  const st = await loadState($)
  if (!st?.run) return 'Rejected: no run.'
  const r = parseQueue({ stage: st.run.stage, slices: [a.stage] })
  if (typeof r === 'string') return `Rejected: ${r}.`
  if (!str(a.text)) return 'Rejected: say why the stage needs it. Fix: pass text.'
  const base = st.run.queue.length - st.run.added
  if (st.run.added + 1 > Math.floor(base * 0.3)) return 'Refused: the run already added 30 % of its queue. Fix: note the idea for the person instead.'
  if (st.run.queue.some(y => y.id === r.queue[0]!.id)) return 'Rejected: that id exists.'
  st.run = { ...st.run, queue: order([...st.run.queue, { ...r.queue[0]!, why: str(a.text) }]), added: st.run.added + 1 }
  return (await saveState($, st), await logEvent($, 'add', { slice: r.queue[0]!.id, why: a.text }), `added ${r.queue[0]!.id}`)
}
async function accept($: Eng, a: Record<string, unknown>): Promise<string> {
  if (!S.interactive || S.isRun) return 'Refused: acceptance happens in the person\'s interactive session.'
  const st = await loadState($)
  const x = st?.run?.queue.find(y => y.id === str(a.id))
  if (!st?.run || !x) return 'Rejected: no such slice.'
  st.run.hold = 0
  if (str(a.verdict) === 'accept') return (await saveState($, st), await logEvent($, 'accepted', { slice: x.id }), `accepted ${x.id}`)
  const why = str(a.text)
  if (str(a.verdict) !== 'reject' || !why) return 'Rejected: pass verdict accept, or reject with text.'
  const id = `${x.id}-fix${st.run.queue.filter(y => y.id.startsWith(`${x.id}-fix`)).length + 1}`
  st.run.queue.push({ ...x, id, status: 'queued', claim: `${x.claim}\nThe person rejected the first version: ${why}`, after: [], why })
  st.misses.push({ t: await $.clock.now(), line: `${x.id}: ${why}` })
  st.calibration = [...(st.calibration ?? []), `${x.id}: verifier passed, person rejected: ${why}`].slice(-8)
  x.status = 'rejected'
  if (!st.run.queue.some(y => y.status === 'queued' && y.id !== id)) st.run.halt = undefined
  return (await saveState($, st), await logEvent($, 'rejected', { slice: x.id, why, fix: id }), `rejected ${x.id}; queued ${id}, noted a miss and a calibration example. /slice:run continues the run.`)
}
export async function report($: Eng): Promise<Record<string, unknown>> {
  const st = await loadState($)
  const ev = await events($)
  const per = (id: string, name: string) => ev.filter(e => e.slice === id && e.event === name)
  return {
    run: st?.run && { ...st.run, queue: st.run.queue.map(x => ({ ...x, notes: per(x.id, 'note'), amends: ev.filter(e => e.event === 'amend' && String(e.key).startsWith(`${x.id}:`)), red: per(x.id, 'red').length > 0 })) },
    last: ev.filter(e => ['prove-all', 'halt', 'pause', 'notify', 'run-end'].includes(e.event)).slice(-12),
    asked: ev.filter(e => e.event === 'asked'),
    pages: st?.run ? `${S.dir}/pages/` : null,
    calibration: st?.calibration ?? [],
    sample: st?.run?.queue.filter(x => x.status === 'merged' && x.risk === 'low').map(x => x.id).sort(() => Math.random() - 0.5)[0] ?? null,
  }
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)
export async function writePage($: Eng, st: State, kind: string): Promise<string> {
  const r = st.run!
  const rows = r.queue.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(x.kind)}</td><td>${esc(x.status)}</td><td>${esc(x.why)}</td><td>${x.disk ?? ''}</td></tr>`).join('')
  const path = `${S.dir}/pages/${r.stage}-${kind}.html`
  await $.process.run(['mkdir', '-p', `${S.dir}/pages`])
  await $.fs.write(path, `<!doctype html><meta charset="utf-8"><title>slice ${esc(r.stage)}</title><style>body{font:15px system-ui;margin:2rem;max-width:60rem}td,th{padding:.3rem .6rem;border-bottom:1px solid #ddd;text-align:left}</style><h1>${esc(r.stage)}: ${kind}</h1><table><tr><th>slice</th><th>kind</th><th>status</th><th>why</th><th>MB</th></tr>${rows}</table>`)
  return path
}

export async function status($: Eng): Promise<string> {
  const st = await loadState($)
  const r = st?.run
  if (!r) return 'no run'
  const by = (s: string) => r.queue.filter(x => x.status === s).map(x => x.id)
  const beat = Number((await $.fs.exists(`${S.dir}/beat`)) ? await $.fs.read(`${S.dir}/beat`) : 0)
  const late = by('running').length && (await $.clock.now()) - beat > 10 * 6e4
  const head = r.halt ? `halted: ${r.halt}` : r.stopped ? 'stopped' : r.paused ? 'paused' : late ? `interrupted: no heartbeat for 10 min; claude attach slice-${r.stage}-<n> and type anything, or /slice-resume` : 'running'
  return [`stage ${r.stage} ${head}`, `merged ${by('merged').join(', ') || '-'}`, `running ${by('running').join(', ') || '-'}`, `in the cloud ${by('cloud').join(', ') || '-'}`, `waiting for you ${[...by('stuck'), ...by('waiting')].join(', ') || '-'}`, `queued ${by('queued').join(', ') || '-'}`].join(' | ')
}
export async function runAction($: Eng, a: Record<string, unknown>, agentId?: string): Promise<string | undefined> {
  const act: Record<string, () => Promise<string>> = { queue: () => queue($, a), start: () => start($, a), merge: () => merge($, a, agentId), add: () => add($, a), accept: () => accept($, a), report: async () => JSON.stringify(await report($)) }
  return act[str(a.action)]?.()
}

export async function onStart($: Eng): Promise<void> {
  S.slice = (await $.env.get('SLICE_SLICE')) ?? ''
  if (S.isRun && S.slice) {
    await logEvent($, 'start', { slice: S.slice, watchdog: await $.env.get('CLAUDE_CODE_RETRY_WATCHDOG'), noUpdate: await $.env.get('DISABLE_AUTOUPDATER') })
    $.clock.every(6e4, () => void $.clock.now().then(t => $.fs.write(`${S.dir}/beat`, String(t))).catch(() => undefined))
  }
  if (!S.interactive || S.isRun) return
  const line = await status($).catch(() => 'no run')
  if (line === 'no run') return
  $.ui.status(`slice: ${line.split(' | ').slice(0, 2).join(' · ')}`)
  if (line.includes('interrupted')) await $.ui.notify(line.split(' | ')[0]!, { title: 'slice' }).catch(() => undefined)
}

// A run session that never started its workflow would idle silently: after 10 min the slice counts as stuck
async function started($: Eng): Promise<void> {
  const ev = await events($)
  const since = ev.filter(x => x.event === 'start' && x.slice === S.slice).at(-1)?.t ?? 0
  const x = (await loadState($))?.run?.queue.find(y => y.id === S.slice)
  if (x?.status === 'running' && !ev.some(y => y.event === 'worktree' && y.id === S.slice && y.t >= since)) await merge($, { id: S.slice, text: 'the feature workflow did not start within 10 minutes of the first turn' })
}
async function control($: Eng, name: string, fn: (r: Run) => Run): Promise<{ text: string }> {
  const st = await loadState($)
  if (!S.active || !st?.run) return { text: 'no run here' }
  await saveState($, { ...st, run: fn(st.run) }), await logEvent($, name)
  if (name === 'slice-stop') {
    for (const [i, x] of st.run.queue.entries()) if (x.status === 'running') await $.process.run(['claude', 'stop', `slice-${st.run.stage}-${i + 1}`])
    await $.store.delete('active').catch(() => undefined)
  }
  return { text: name === 'slice-resume' ? await next($) : `${name.slice(6)}d at the next slice boundary` }
}

export const register = (on: On): void => {
  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    if (!e.agentId) while (LATER.length) await $.prompt.submit({ text: LATER.shift()! }).catch(err => logEvent($, 'submit-error', { error: String(err) }))
    if (!e.agentId && S.isRun && S.slice && !WATCHED.has(S.slice)) WATCHED.add(S.slice), $.clock.after(10 * 6e4, () => void started($).catch(() => undefined))
    return out
  })
  on('command.run', { command: 'slice-pause' }, async $ => control($, 'slice-pause', r => ({ ...r, paused: true })))
  on('command.run', { command: 'slice-resume' }, async $ => control($, 'slice-resume', r => ({ ...r, paused: false, halt: undefined })))
  on('command.run', { command: 'slice-stop' }, async $ => control($, 'slice-stop', r => ({ ...r, stopped: true })))
}
