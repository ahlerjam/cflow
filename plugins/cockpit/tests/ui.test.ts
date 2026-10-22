import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_CONFIG } from '../hooks/defaults'

// The pane through the engine: the mod's hooks, atoms and render hook are real,
// only the engine operations underneath (filesystem, gh, HTTP) are faked.

const NOW = Date.parse('2026-10-15T12:00:00Z')
const REPO = 'acme/widgets'
const LONG_NAME = 'a very long workflow name that does not fit'
const LONG_BRANCH = 'feat/a-very-long-branch-name'

const RUNS = [
  { databaseId: 101, name: 'ci', status: 'completed', conclusion: 'failure', headBranch: 'main', createdAt: '2026-10-15T11:00:00Z', startedAt: '2026-10-15T11:00:00Z', updatedAt: '2026-10-15T11:19:00Z', url: `https://github.com/${REPO}/actions/runs/101` },
  { databaseId: 102, name: LONG_NAME, status: 'completed', conclusion: 'success', headBranch: LONG_BRANCH, createdAt: '2026-10-15T10:00:00Z', startedAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:05:00Z', url: `https://github.com/${REPO}/actions/runs/102` },
  { databaseId: 103, name: 'deploy', status: 'in_progress', conclusion: null, headBranch: 'dev', createdAt: '2026-10-15T09:00:00Z', startedAt: '2026-10-15T09:00:00Z', updatedAt: '2026-10-15T09:30:00Z', url: `https://github.com/${REPO}/actions/runs/103` },
]

const step = (number: number, name: string, conclusion: string, from: string, to: string) => ({ number, name, status: 'completed', conclusion, startedAt: from, completedAt: to })

const RUN_DETAIL = {
  databaseId: 101,
  name: 'ci',
  displayTitle: 'fix: Etappen planen',
  event: 'push',
  headBranch: 'main',
  headSha: 'abc1234def',
  status: 'completed',
  conclusion: 'failure',
  createdAt: '2026-10-15T11:00:00Z',
  startedAt: '2026-10-15T11:00:00Z',
  updatedAt: '2026-10-15T11:19:00Z',
  url: `https://github.com/${REPO}/actions/runs/101`,
  attempt: 1,
  jobs: [
    {
      databaseId: 201,
      name: 'pytest',
      status: 'completed',
      conclusion: 'failure',
      startedAt: '2026-10-15T11:00:01Z',
      completedAt: '2026-10-15T11:00:40Z',
      url: `https://github.com/${REPO}/actions/runs/101/job/201`,
      steps: [
        step(1, 'Set up job', 'success', '2026-10-15T11:00:01Z', '2026-10-15T11:00:02Z'),
        step(2, 'Run pytest', 'failure', '2026-10-15T11:00:03Z', '2026-10-15T11:00:40Z'),
      ],
    },
    {
      databaseId: 202,
      name: 'lint',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-10-15T11:00:01Z',
      completedAt: '2026-10-15T11:00:30Z',
      url: `https://github.com/${REPO}/actions/runs/101/job/202`,
      steps: [step(1, 'Run ruff', 'success', '2026-10-15T11:00:05Z', '2026-10-15T11:00:30Z')],
    },
  ],
}

const LOG = [
  'pytest\tUNKNOWN STEP\t2026-10-15T11:00:01.500Z Current runner version',
  'pytest\tUNKNOWN STEP\t2026-10-15T11:00:04.000Z ##[group]Run pytest -q',
  'pytest\tUNKNOWN STEP\t2026-10-15T11:00:05.000Z collected 3 items',
  'pytest\tUNKNOWN STEP\t2026-10-15T11:00:30.000Z FAILED tests/test_x.py::test_a - boom',
  'pytest\tUNKNOWN STEP\t2026-10-15T11:00:39.000Z error: 1 failed, 2 passed',
].join('\n')

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

type Calls = { toasts: string[]; statuses: Array<string | undefined>; writes: string[]; argvs: string[][] }

type PaneRow = { id: string; title: string; isPlaced: boolean; isShown: boolean; isFocused: boolean }
// Open panes as the engine tracks them; only tests with trackPanes maintain them
const panes: PaneRow[] = []

async function boot($: Engine, on: On, demo = true, stored: Record<string, unknown> = {}, trackPanes = false): Promise<Calls> {
  panes.length = 0
  const calls: Calls = { toasts: [], statuses: [], writes: [], argvs: [] }
  mock.store(on, stored)
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/preview' })
  let config = JSON.stringify({ ...DEFAULT_CONFIG, settings: { ...DEFAULT_CONFIG.settings, demo, issueSummaries: demo } })
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: config }))
  on('fs.write', async (_, e) => {
    config = e.text
    calls.writes.push(config)
    return { value: undefined }
  })
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('tool.list', async () => ({ value: [] }))
  on('ui.open', async (_, e) => {
    if (trackPanes && !panes.some(p => p.id === e.id)) panes.push({ id: e.id, title: e.title ?? '', isPlaced: true, isShown: true, isFocused: false })
    return { value: { isPlaced: true } }
  })
  on('ui.status', async (_, e) => {
    calls.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', async (_, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: trackPanes ? [...panes] : [] }))
  on('ui.close', async (_, e) => {
    const i = panes.findIndex(p => p.id === e.id)
    if (i >= 0) panes.splice(i, 1)
    return { value: undefined }
  })
  on('http.fetch', async () => ({
    value: {
      status: 200,
      ok: true,
      headers: {},
      text: '{"vms":{"ready":2,"busy":5},"demand":1,"mode":"managed","sizes":{"normal":4,"large":3}}',
    },
  }))
  on('session.root', async () => ({ value: '/r' }))
  on('session.repo', async () => ({
    value: { root: '/r', remote: 'https://github.com/acme/widgets.git', internal: false, name: 'widgets' },
  }))
  on('command.register', async (_, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_, e) => ({ value: { tool: `mcp__cockpit__${e.name}` } }))
  on('session.start', async (_, e) => e)
  on('process.run', async (_, e) => {
    const argv = [...e.argv]
    calls.argvs.push(argv)
    const out = (stdout: string, exitCode = 0) => ({
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (argv[1] === 'run' && argv[2] === 'list') return out(JSON.stringify(RUNS))
    if (argv[1] === 'run' && argv[2] === 'view' && argv.includes('--log')) return out(LOG)
    if (argv[1] === 'run' && argv[2] === 'view') return out(JSON.stringify(RUN_DETAIL))
    if (argv[1] === 'pr') return out('', 1)
    // issue search: 10 hits per request, 15 in total; the second request (with after) brings the rest
    if (argv[1] === 'api' && argv.some(a => a.startsWith('q=repo:'))) {
      const isMore = argv.some(a => a.startsWith('after='))
      const numbers = isMore ? [5, 4, 3, 2, 1] : [15, 14, 13, 12, 11, 10, 9, 8, 7, 6]
      return out(JSON.stringify({ data: { search: {
        issueCount: 15,
        pageInfo: { hasNextPage: !isMore, endCursor: isMore ? null : 'c1' },
        nodes: numbers.map(n => ({ number: n, title: `Issue ${n}`, url: `u${n}`, body: '', updatedAt: '2026-10-15T10:00:00Z',
          labels: { nodes: [] }, blockedBy: { nodes: [] }, blocking: { nodes: [] }, closedByPullRequestsReferences: { nodes: [] }, comments: { totalCount: 0 } })),
      } } }))
    }
    return out('{}')
  })
  return calls
}

async function openPane($: Engine, args: string) {
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: false } as never)
  await $.command.run({ ...RUN, command: 'cockpit', args })
  const ui = await $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: { title: 'Cockpit', isFocused: true, bodyColumns: 72, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as never)
  return ui
}

describe('Pane: Actions', () => {
  test('run list shows rows of equal width', async ($, on) => {
    await boot($, on)
    const ui = await openPane($, 'actions')
    // Loads that are not awaited only settle after a ui.press
    await ui.press({ key: 'act-refresh' })
    const buttons = (await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('run-open-'))
    expect(buttons.map(b => b.key)).toEqual(['run-open-101', 'run-open-102', 'run-open-103'])
    const labels = buttons.map(b => String(b.props['label']))
    expect(labels[0]).toContain('failed')
    expect(labels[1]).toContain('…')
    expect(labels[0]?.length).toBe(labels[1]?.length)
    expect(labels[2]?.length).toBe(labels[1]?.length)
  })

  test('clicking a run shows its jobs, the failed one is expanded', async ($, on) => {
    await boot($, on)
    const ui = await openPane($, 'actions')
    // Loads that are not awaited only settle after a ui.press
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'run-open-101' })

    const jobButtons = (await ui.findAll({ type: 'Button' })).filter(b => b.key === 'job-201' || b.key === 'job-202')
    expect(jobButtons.map(b => b.key)).toEqual(['job-201', 'job-202'])
    expect(String(jobButtons[0]?.props['label'])).toMatch(/^▾ pytest/)
    expect(String(jobButtons[1]?.props['label'])).toMatch(/^▸ lint/)
    expect(await ui.find({ type: 'Button', key: 'step-201-2' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'step-202-1' })).toBeUndefined()
    // card with fields, jobs with counters below
    expect(await ui.find({ type: 'Text', text: /^ci · failed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Jobs' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 ✗' })).toBeDefined()
  })

  test('clicking a step opens the log, "Errors only" filters', async ($, on) => {
    await boot($, on)
    const ui = await openPane($, 'actions')
    // Loads that are not awaited only settle after a ui.press
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'run-open-101' })
    await ui.press({ key: 'step-201-2' })

    const code = async () => String((await ui.find({ type: 'Code' }))?.props['source'] ?? '')
    expect((await code()).split('\n')).toEqual([
      '▸ Run pytest -q',
      'collected 3 items',
      'FAILED tests/test_x.py::test_a - boom',
      'error: 1 failed, 2 passed',
    ])
    expect(await ui.find({ type: 'Text', text: /^pytest · failed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Run pytest\s+$/ })).toBeDefined()

    await ui.press({ key: 'log-err' })
    expect((await code()).split('\n')).toEqual(['FAILED tests/test_x.py::test_a - boom', 'error: 1 failed, 2 passed'])
    expect(await ui.find({ type: 'Text', text: /^2 error lines of 4 lines$/ })).toBeDefined()

    await ui.press({ key: 'log-err' })
    expect((await code()).split('\n')).toHaveLength(4)
    await ui.press({ key: 'log-back' })
    expect(await ui.find({ type: 'Button', key: 'job-201' })).toBeDefined()
  })
})

describe('Pane: Issues', () => {
  test('demo shows names and summary, detail opens, the switch hides the AI line', async ($, on) => {
    await boot($, on)
    const ui = await openPane($, 'issues')
    await ui.press({ key: 'tab-issues' })

    const summary248 = /Sign-in with more than five tenants times out/
    const title = await ui.find({ type: 'Button', key: 'issue-open-248' })
    expect(String(title?.props['label'])).toMatch(/^#248 Login fails with SSO/)
    expect(await ui.find({ type: 'Text', text: summary248 })).toBeDefined()

    await ui.press({ key: 'issue-open-248' })
    expect(await ui.find({ type: 'Button', key: 'iss-back' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^AI: Sign-in with more/ })).toBeDefined()
    expect(await ui.find({ type: 'Markdown', text: /Reproduced with 6 tenants/ })).toBeDefined()

    await ui.press({ key: 'iss-back' })
    await ui.press({ key: 'issue-sum' })
    expect(await ui.find({ type: 'Text', text: summary248 })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /AI is summarizing/ })).toBeUndefined()

    await ui.press({ key: 'issue-open-248' })
    expect(await ui.find({ type: 'Text', text: /^AI: / })).toBeUndefined()
  })
})

describe('Pane: Issues paging', () => {
  test('jump to pages, total from GitHub, loading more appends', async ($, on) => {
    const calls = await boot($, on, false)
    const ui = await openPane($, 'issues')
    await ui.press({ key: 'tab-issues' })
    await ui.press({ key: 'issue-refresh' })

    expect(await ui.find({ type: 'Text', text: /10 of 15 open/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'issue-open-15' })).toBeDefined()
    // at most 100 per request even if more is configured
    expect(calls.argvs.find(a => a.includes('n=100'))).toBeDefined()

    await ui.press({ key: 'iss-page-1' })
    expect(await ui.find({ type: 'Button', key: 'issue-open-15' })).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'iss-page-1' }))?.props['variant']).toBe('primary')

    await ui.press({ key: 'iss-more' })
    expect(calls.argvs.find(a => a.includes('after=c1'))).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /● 15 open/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'iss-more' })).toBeUndefined()
    // after loading more, the page with the first new issue is shown
    expect(await ui.find({ type: 'Button', key: 'issue-open-5' })).toBeDefined()

    await ui.press({ key: 'iss-page-0' })
    expect(await ui.find({ type: 'Button', key: 'issue-open-15' })).toBeDefined()
  })
})

describe('Pane: Sources', () => {
  test('overview and manage plugins are two views, the status line counts', async ($, on) => {
    const calls = await boot($, on)
    const ui = await openPane($, 'sources')
    await ui.press({ key: 'tab-sources' })
    expect((await ui.find({ type: 'Button', key: 'sources-overview' }))?.props['variant']).toBe('primary')
    expect(calls.statuses.at(-1)).toMatch(/^Cockpit: \d+ on · 0 loaded/)

    await ui.press({ key: 'sources-plugins' })
    expect(await ui.find({ type: 'Button', key: 'plg-refresh' })).toBeDefined()
    expect((await ui.find({ type: 'Button', key: 'sources-plugins' }))?.props['variant']).toBe('primary')
    await ui.press({ key: 'sources-overview' })
    expect(await ui.find({ type: 'Button', key: 'plg-refresh' })).toBeUndefined()
  })
})

describe('Band: reopen Cockpit', () => {
  test('closed: button above the prompt; the button opens the pane, without a pane it is back', async ($, on) => {
    await boot($, on, true, {}, true)
    on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)
    await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: false } as never)
    const band = await $.ui.mount({
      plugin: 'cockpit',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    } as never)
    expect(await band.find({ type: 'Button', key: 'band-open' })).toBeDefined()

    await band.press({ key: 'band-open' })
    expect(panes.map(p => p.id)).toEqual(['cockpit'])
    expect(await band.find({ type: 'Button', key: 'band-open' })).toBeUndefined()

    // The person closes the pane (a test cannot trigger ui.close): a redrawn band shows the button
    await band.unmount()
    panes.length = 0
    const again = await $.ui.mount({
      plugin: 'cockpit',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    } as never)
    expect(await again.find({ type: 'Button', key: 'band-open' })).toBeDefined()
  })
})
