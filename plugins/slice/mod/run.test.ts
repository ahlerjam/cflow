import { expect, test, type Engine } from 'claude-code/testing'
import { DIR, ROOT, boot, type Opts, type Reply } from './kit'

const CACHE = '/h/.cache/slice/r-' + (() => {
  let h = 0x811c9dc5
  for (const c of ROOT) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
})()
const WT = `${CACHE}/run`
const feat = (id: string, passes = false, title = `Title ${id}`) => ({ id, title, steps: ['open', 'see'], passes })
const list = (...features: unknown[]) => JSON.stringify({ features })
const RUN = {
  branch: 'slice/run-19700101-0000', base: 'abc', baseBranch: 'main', wt: WT, t0: 0, costUsd: 1.5,
  sessionCosts: { s0: 1.5 }, resumes: 0, stalls: 0, lastPassed: 0, sessionId: '', last: 'started',
}
const state = (over: object = {}) => JSON.stringify({ misses: [], run: { ...RUN, ...over } })
const WORKER = `${CACHE}/worker.json`
const result = (over: object = {}) => JSON.stringify({
  subtype: 'success', is_error: false, session_id: 's1', total_cost_usd: 2, num_turns: 9, ...over,
})

const git = (over: Record<string, Reply> = {}) => (argv: readonly string[]): Reply | undefined => {
  if (argv[0] !== 'git' || argv[3] === 'rev-parse' && argv[4]?.startsWith('--path-format')) return undefined
  const key = argv.slice(3).join(' ')
  const hit = Object.entries(over).find(([k]) => key.startsWith(k))
  if (hit) return hit[1]
  if (key === 'rev-parse HEAD') return { stdout: 'abc' }
  if (key === 'rev-parse --abbrev-ref HEAD') return { stdout: 'main' }
  return { stdout: '' }
}
const tool = async ($: Engine, input: object) => {
  const r = await $.tool.call({ tool: 'mcp__slice__slice', ...input } as never)
  return String((r as { result: unknown }).result)
}
const decision = async ($: Engine, input: object) => JSON.parse(await tool($, input)) as Record<string, unknown>
const setup = (over: Opts & { git?: Record<string, Reply> } = {}): Opts => ({
  marker: '{}', proc: git(over.git), ...over,
})
const base = { [`${ROOT}/.slice/features.json`]: list(feat('f1'), feat('f2')) }

test('worker refuses a dirty working tree', async ($, on) => {
  const { runs } = await boot($, on, setup({ git: { status: { stdout: ' M a.ts' } }, files: base }))
  expect(await tool($, { action: 'worker' })).toContain('not clean')
  expect(runs.some(r => r.includes('worktree'))).toBe(false)
})
test('worker command carries goal, budget, turns and settings', async ($, on) => {
  await boot($, on, setup({ marker: '{"budgetUsd":7,"maxTurns":50}', files: base }))
  const { cwd, command } = await decision($, { action: 'worker' }) as { cwd: string; command: string }
  expect(cwd).toBe(WT)
  expect(command.startsWith(`cd '${WT}' && SLICE_RUN=1 claude -p`)).toBe(true)
  expect(command).toContain('Done means: every feature in .slice/features.json')
  expect(command).toContain('--max-budget-usd 7 --max-turns 50')
  expect(command).toContain(`--settings '${CACHE}/run-settings.json'`)
})
test('worker writes the marker domains and excluded commands into the run settings', async ($, on) => {
  const marker = '{"allowedDomains":["api.example.com"],"excludedCommands":["docker compose *"]}'
  const { files } = await boot($, on, setup({ marker, files: base }))
  await tool($, { action: 'worker' })
  const sandbox = JSON.parse(files[`${CACHE}/run-settings.json`] ?? '').sandbox
  expect([sandbox.network.allowedDomains, sandbox.excludedCommands, sandbox.filesystem.allowWrite])
    .toEqual([['registry.test', 'api.example.com'], ['docker compose *'], [WT]])
})
test('worker command has --plugin-dir only with SLICE_PLUGIN_DIR', async ($, on) => {
  await boot($, on, setup({ files: base }))
  expect(await tool($, { action: 'worker' })).not.toContain('--plugin-dir')
})
test('worker command passes SLICE_PLUGIN_DIR as --plugin-dir', async ($, on) => {
  await boot($, on, setup({ files: base, env: { SLICE_PLUGIN_DIR: '/p/slice' } }))
  expect(await tool($, { action: 'worker' })).toContain("--plugin-dir '/p/slice'")
})
test('worker stores the run in state.json', async ($, on) => {
  const { files } = await boot($, on, setup({ files: base }))
  await tool($, { action: 'worker' })
  const run = JSON.parse(files[`${DIR}/state.json`] ?? '').run
  expect([run.base, run.baseBranch, run.wt]).toEqual(['abc', 'main', WT])
})
test('the first worker command starts the session under the stored id', async ($, on) => {
  const { files } = await boot($, on, setup({ files: base }))
  const { command } = await decision($, { action: 'worker' }) as { command: string }
  const id = JSON.parse(files[`${DIR}/state.json`] ?? '').run.sessionId
  expect([id.length, command]).toEqual([36, expect.stringContaining(`--session-id '${id}'`)])
})
test('worker with resume builds a --resume command', async ($, on) => {
  await boot($, on, setup({ state: state(), files: base }))
  const { command } = await decision($, { action: 'worker', resume: 'sid-1' }) as { command: string }
  expect(command).toContain("-p --resume 'sid-1' 'Continue toward the goal.'")
})

const checkOpts = (now: string, out = result(), over: Opts = {}): Opts => setup({
  state: state(),
  files: { [`${WT}/.slice/features.json`]: now, ...(out ? { [WORKER]: out } : {}) },
  git: { show: { stdout: list(feat('f1'), feat('f2')) } },
  ...over,
})
const check = ($: Engine) => decision($, { action: 'check' })
const MAX_TURNS = result({ subtype: 'error_max_turns', is_error: true })
const stored = (files: Record<string, string>) => JSON.parse(files[`${DIR}/state.json`] ?? '').run

test('check halts when the feature list changed beyond passes', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1', true, 'Renamed'), feat('f2'))))
  const r = await check($)
  expect([r.action, r.reason]).toEqual(['halt', 'feature list changed beyond passes'])
})
test('check returns finish when every feature passes', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1', true), feat('f2', true))))
  expect((await check($)).action).toBe('finish')
})
test('check reads the session id from the worker output file', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1', true), feat('f2')), result({ session_id: 'from-file' })))
  expect((await check($)).session_id).toBe('from-file')
})
test('check returns resume with the session id after error_max_turns', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1', true), feat('f2')), MAX_TURNS))
  const r = await check($)
  expect([r.action, r.session_id, r.passed, r.total]).toEqual(['resume', 's1', 1, 2])
})
test('check halts after two resumes without a new passing feature', async ($, on) => {
  const stuck = state({ stalls: 2, sessionId: 's1' })
  await boot($, on, checkOpts(list(feat('f1'), feat('f2')), MAX_TURNS, { state: stuck }))
  expect((await check($)).action).toBe('halt')
})
test('check treats a missing output file as a crash and resumes the known session', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1'), feat('f2')), '', { state: state({ sessionId: 's0' }) }))
  const r = await check($)
  expect([r.action, r.session_id]).toEqual(['resume', 's0'])
})
test('check treats unparsable output as a crash', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1'), feat('f2')), 'Killed', { state: state({ sessionId: 's0' }) }))
  expect((await check($)).action).toBe('resume')
})
test('check replaces the cost of a resumed session', async ($, on) => {
  const out = result({ session_id: 's0', total_cost_usd: 2 })
  const { files } = await boot($, on, checkOpts(list(feat('f1'), feat('f2')), out))
  expect([(await check($)).costUsd, stored(files).costUsd]).toEqual([2, 2])
})
test('check adds the cost of a new session', async ($, on) => {
  const { files } = await boot($, on, checkOpts(list(feat('f1'), feat('f2'))))
  expect([(await check($)).costUsd, stored(files).costUsd]).toEqual([3.5, 3.5])
})

test('finish merge refuses a dirty main checkout', async ($, on) => {
  const { runs } = await boot($, on, setup({
    state: state(), files: { [`${WT}/.slice/features.json`]: list(feat('f1', true)) },
    git: { status: { stdout: ' M a.ts' } },
  }))
  expect(await tool($, { action: 'finish', mode: 'merge' })).toContain('not clean')
  expect(runs.some(r => r.includes('merge'))).toBe(false)
})
test('finish branch removes the worktree and clears the run', async ($, on) => {
  const { files, runs } = await boot($, on, setup({
    state: state(), files: { [`${WT}/.slice/features.json`]: list(feat('f1', true)) },
  }))
  await tool($, { action: 'finish', mode: 'branch' })
  expect(runs.some(r => r.join(' ').includes(`worktree remove --force ${WT}`))).toBe(true)
  expect(JSON.parse(files[`${DIR}/state.json`] ?? '').run).toBeUndefined()
})
test('worktree and output paths are outside the git dir', async ($, on) => {
  await boot($, on, setup({ files: base }))
  const { cwd, command } = await decision($, { action: 'worker' }) as { cwd: string; command: string }
  expect(cwd).toBe(WT)
  expect(`${cwd} ${command}`).not.toContain('/.git/')
})
test('the cache dir honors XDG_CACHE_HOME', async ($, on) => {
  await boot($, on, setup({ files: base, env: { XDG_CACHE_HOME: '/x' } }))
  expect((await decision($, { action: 'worker' })).cwd).toMatch(/^\/x\/slice\/r-[0-9a-f]{8}\/run$/)
})
test('finish prunes the worktree list when the directory is already gone', async ($, on) => {
  const { runs } = await boot($, on, setup({
    state: state(), files: { [`${WT}/.slice/features.json`]: list(feat('f1', true)) },
    git: { 'worktree remove': { exitCode: 1, stderr: 'not a working tree' } },
  }))
  await tool($, { action: 'finish', mode: 'branch' })
  expect(runs.some(r => r.includes('prune'))).toBe(true)
})
test('check halts once the run budget is reached', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1', true), feat('f2')), MAX_TURNS, { marker: '{"runBudgetUsd":3}' }))
  const r = await check($)
  expect([r.action, r.reason]).toEqual([
    'halt', 'run budget of $3 reached; the builder hit its turn limit; 1 of 2 remain',
  ])
})
test('check does not halt below the run budget', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1', true), feat('f2')), MAX_TURNS, { marker: '{"runBudgetUsd":4}' }))
  expect((await check($)).action).toBe('resume')
})
test('check says plainly when every feature passes but the builder stopped on budget', async ($, on) => {
  const out = result({ subtype: 'error_max_budget_usd', is_error: true })
  await boot($, on, checkOpts(list(feat('f1', true), feat('f2', true)), out))
  expect((await check($)).reason).toContain('the builder hit its budget; all features pass')
})
test('a crash on the first call resumes the stored session id', async ($, on) => {
  const show = { stdout: base[`${ROOT}/.slice/features.json`] }
  const { files } = await boot($, on, setup({ files: base, git: { show } }))
  await tool($, { action: 'worker' })
  files[`${WT}/.slice/features.json`] = list(feat('f1'), feat('f2'))
  const id = JSON.parse(files[`${DIR}/state.json`] ?? '').run.sessionId
  const r = await check($)
  expect([r.action, r.session_id]).toEqual(['resume', id])
})
const LIMIT_OUT = result({ subtype: 'error_during_execution', is_error: true, result: 'Claude usage limit reached' })
const RESET = { kind: 'five_hour', percentUsed: 100, resetsAt: new Date(600_000).toISOString() }
test('check waits until the reset when the builder hit the usage limit', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1'), feat('f2')), LIMIT_OUT, { limits: [RESET] }))
  const r = await check($)
  expect([r.action, r.seconds, r.session_id]).toEqual(['wait', 660, 's1'])
})
test('check waits 15 minutes when the reset time is unknown', async ($, on) => {
  await boot($, on, checkOpts(list(feat('f1'), feat('f2')), LIMIT_OUT))
  expect((await check($)).seconds).toBe(900)
})
test('a wait does not count as a stall', async ($, on) => {
  const opts = checkOpts(list(feat('f1'), feat('f2')), LIMIT_OUT, { state: state({ stalls: 2 }) })
  const { files } = await boot($, on, opts)
  expect([(await check($)).action, stored(files).stalls]).toEqual(['wait', 2])
})
const COMMITS = { stdout: 'c1\tslice: f1 Title f1\nc2\tslice: f2 Title f2' }
const DONE = { [`${WT}/.slice/features.json`]: list(feat('f1', true), feat('f2', true)) }
test('feature-prs names the branches after the run', async ($, on) => {
  const { runs } = await boot($, on, setup({ state: state(), files: DONE, git: { log: COMMITS } }))
  await tool($, { action: 'finish', mode: 'feature-prs' })
  const heads = runs.filter(r => r[0] === 'gh').map(r => r[r.indexOf('--head') + 1])
  expect(heads).toEqual([`${RUN.branch}-f1`, `${RUN.branch}-f2`])
})
test('feature-prs stacks each PR on the previous branch', async ($, on) => {
  const { runs } = await boot($, on, setup({ state: state(), files: DONE, git: { log: COMMITS } }))
  await tool($, { action: 'finish', mode: 'feature-prs' })
  const bases = runs.filter(r => r[0] === 'gh').map(r => r[r.indexOf('--base') + 1])
  expect(bases).toEqual(['main', `${RUN.branch}-f1`])
})
test('feature-prs refuses a branch that already exists on origin and keeps the worktree', async ($, on) => {
  const { runs } = await boot($, on, setup({
    state: state(), files: DONE,
    git: { log: COMMITS, 'ls-remote': { stdout: 'c1\trefs/heads/x' } },
  }))
  expect(await tool($, { action: 'finish', mode: 'feature-prs' })).toContain('already exists on origin')
  expect(runs.some(r => r.includes('remove'))).toBe(false)
})
test('the single PR title names the features', async ($, on) => {
  const { runs } = await boot($, on, setup({ state: state(), files: DONE }))
  await tool($, { action: 'finish', mode: 'pr' })
  const gh = runs.find(r => r[0] === 'gh') ?? []
  expect(gh[gh.indexOf('--title') + 1]).toBe('slice: 2 features (Title f1 and 1 more)')
})
