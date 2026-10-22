import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { isAllowedUrl, parseRemote } from '../hooks/core'
import { DEFAULT_CONFIG } from '../hooks/defaults'
import { runEndText } from '../hooks/actions'
import { cleanPool, httpsHost } from '../hooks/sources'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const HEALTH = 'https://pool.example.org/health'
const VMS = 'https://pool.example.org/vms'

const run = (id: number, status: string, conclusion: string | null, branch = 'feat/x') => ({
  databaseId: id, name: 'ci', status, conclusion, headBranch: branch, attempt: 1,
  createdAt: '2026-10-15T11:00:00Z', startedAt: '2026-10-15T11:00:00Z', updatedAt: '2026-10-15T11:05:00Z',
  url: `https://github.com/acme/widgets/actions/runs/${id}`,
})

type Out = { exitCode: number; stdout?: string; stderr?: string }
type World = {
  runs: unknown[]
  branch: string
  repoView: Out
  ghVersion: number
  auth: number
  stderr: string
  extra: (argv: string[]) => Out | undefined
  notify: (text: string) => boolean
}
type Opts = { settings?: Record<string, unknown>; env?: Record<string, string>; interactive?: boolean; repo?: boolean; remote?: string; stderr?: string }

async function boot($: Engine, on: On, opts: Opts = {}) {
  const world: World = { runs: [], branch: 'feat/x', repoView: { exitCode: 1 }, ghVersion: 0, auth: 0, stderr: opts.stderr ?? '', extra: () => undefined, notify: () => true }
  const calls = { argvs: [] as string[], toasts: [] as string[], notes: [] as string[], fetches: [] as Array<{ url: string; headers?: Record<string, string> | undefined }> }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/preview', ...opts.env })
  const config = JSON.stringify({ ...DEFAULT_CONFIG, settings: { ...DEFAULT_CONFIG.settings, ...opts.settings } })
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ value: config }))
  on('fs.write', async () => ({ value: undefined }))
  on('settings.read', async () => ({ value: {} }))
  on('command.list', async () => ({ value: [] }))
  on('tool.list', async () => ({ value: [] }))
  const panes: Array<{ id: string; title: string; isPlaced: boolean; isShown: boolean; isFocused: boolean }> = []
  on('ui.open', async (_, e) => {
    panes.push({ id: e.id, title: '', isPlaced: true, isShown: true, isFocused: false })
    return { value: { isPlaced: true } }
  })
  on('ui.panes', async () => ({ value: [...panes] }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', async () => ({ value: undefined }))
  on('http.fetch', async (_, e) => {
    calls.fetches.push({ url: e.url, headers: e.init?.headers })
    const text = e.url === VMS
      ? JSON.stringify({ limits: { maxPool: 4 }, vms: [{ name: 'r1', repo: 'widgets', state: 'busy', createdAt: 1 }] })
      : '{"vms":{},"demand":0,"mode":"managed"}'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('session.root', async () => ({ value: '/r' }))
  on('session.repo', async () => ({
    value: opts.repo === false ? null : { root: '/r', remote: opts.remote ?? 'https://github.com/acme/widgets.git', internal: false, name: 'widgets' },
  }))
  on('command.register', async (_, e) => ({ value: { command: e.name } }))
  on('session.start', async (_, e) => e)
  on('process.run', async (_, e) => {
    const argv = [...e.argv]
    calls.argvs.push(argv.join(' '))
    const out = (o: Out) => ({ value: { exitCode: o.exitCode, stdout: o.stdout ?? '', stderr: o.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } })
    const custom = world.extra(argv)
    if (custom) return out(custom)
    const [bin, a, b] = argv
    if (argv.includes('--version')) return out({ exitCode: world.ghVersion })
    if (bin === 'uname') return out({ exitCode: 0, stdout: 'Linux\n' })
    if (bin === 'git') return out(world.branch ? { exitCode: 0, stdout: `${world.branch}\n` } : { exitCode: 1 })
    if (a === 'auth') {
      world.auth += 1
      return out({ exitCode: world.auth > 0 && world.ghVersion === 0 && !calls.argvs.includes('NOAUTH') ? 0 : 1 })
    }
    if (a === 'repo' && b === 'view') return out(world.repoView)
    if (a === 'run' && b === 'list') return world.stderr ? out({ exitCode: 1, stderr: world.stderr }) : out({ exitCode: 0, stdout: JSON.stringify(world.runs) })
    if (a === 'pr') return out({ exitCode: 1 })
    return out({ exitCode: 0 })
  })
  on('ui.notify', async (_, e) => ({ value: world.notify(e.text) ? { isSent: true, channel: 'kitty' } : { isSent: false, reason: 'no-channel' } }) as never)
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: opts.interactive ?? false } as never)
  await clock.settle()
  return { world, calls, clock }
}

async function pane($: Engine, tab = 'actions') {
  const ui = await $.ui.mount({
    plugin: 'cockpit', surface: 'terminal', component: 'Pane', requestId: 'cockpit',
    props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as never)
  await ui.press({ key: `tab-${tab}` })
  return ui
}

const texts = (ui: Awaited<ReturnType<typeof pane>>, re: RegExp) => ui.findAll({ type: 'Text', text: re })

const AT = '@'

describe('runner pool setting', () => {
  test('only valid https pools are kept', () => {
    expect(cleanPool({ healthUrl: 'http://x.example/health' })).toBeUndefined()
    expect(cleanPool({ healthUrl: `https://user${AT}x.example/health` })).toBeUndefined()
    expect(cleanPool({ healthUrl: HEALTH, vmsUrl: 'ftp://x' })).toBeUndefined()
    expect(cleanPool({ healthUrl: HEALTH, token: { env: 'bad name' } })).toBeUndefined()
    expect(cleanPool({ healthUrl: HEALTH, owner: 'a b' })).toBeUndefined()
    expect(cleanPool({ healthUrl: HEALTH, tokenCommand: ['op', 'read', 'x'], maxPool: 6, maxRunnersPerRepo: 3 }))
      .toEqual({ healthUrl: HEALTH, token: { command: ['op', 'read', 'x'] }, maxPool: 6, maxRunnersPerRepo: 3 })
    expect(cleanPool({ healthUrl: HEALTH, maxPool: 0.5 })).toBeUndefined()
    expect(cleanPool({ healthUrl: HEALTH, vmsUrl: VMS, token: { command: ['pass', 'x'] }, label: 'Pool', owner: 'acme' }))
      .toEqual({ healthUrl: HEALTH, vmsUrl: VMS, token: { command: ['pass', 'x'] }, label: 'Pool', owner: 'acme' })
    expect(httpsHost(HEALTH)).toBe('pool.example.org')
  })

  test('the opener allows GitHub and the pool hosts only', () => {
    const pool = cleanPool({ healthUrl: HEALTH })
    expect(isAllowedUrl('https://github.com/acme/widgets', undefined)).toBe(true)
    expect(isAllowedUrl('https://pool.example.org/health', pool)).toBe(true)
    expect(isAllowedUrl('https://pool.example.org/health', undefined)).toBe(false)
    expect(isAllowedUrl('https://other.example/x', pool)).toBe(false)
    expect(isAllowedUrl(`https://github.com${AT}evil.example/x`, pool)).toBe(false)
  })

  test('unset: no pool UI, no health timer, no fetch', async ($, on) => {
    const { world, calls, clock } = await boot($, on, { interactive: true })
    world.runs = [run(1, 'in_progress', null), run(2, 'queued', null)]
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    expect(await ui.find({ type: 'Button', key: 'act-runners' })).toBeUndefined()
    expect((await texts(ui, /1 in progress · 1 queued/)).length).toBe(1)
    await clock.advance(120_000)
    expect(calls.fetches).toEqual([])
  })

  test('set: card, Runner sub-tab and a health request while the pane is open', async ($, on) => {
    const { calls, clock } = await boot($, on, { interactive: true, settings: { runnerPool: { healthUrl: HEALTH, label: 'Pool' } } })
    const ui = await pane($)
    expect(await ui.find({ type: 'Button', key: 'act-runners' })).toBeDefined()
    await clock.advance(60_000)
    expect(calls.fetches.filter(f => f.url === HEALTH).length).toBeGreaterThan(0)
    expect(calls.fetches.some(f => f.url === VMS)).toBe(false)
    await ui.press({ key: 'tab-settings' })
    expect((await texts(ui, /configured: Pool/)).length).toBe(1)
  })

  test('a pane opened by openOnStart starts the minute health poll', async ($, on) => {
    const { calls, clock } = await boot($, on, { interactive: true, settings: { openOnStart: true, runnerPool: { healthUrl: HEALTH } } })
    await clock.advance(60_000)
    expect(calls.fetches.filter(f => f.url === HEALTH).length).toBeGreaterThan(0)
  })

  test('settings show the pool as not configured', async ($, on) => {
    await boot($, on)
    const ui = await pane($, 'settings')
    expect((await texts(ui, /not configured, see README/)).length).toBe(1)
  })

  test('token from a command, read once; short repo names get the pool owner', async ($, on) => {
    const { world, calls } = await boot($, on, { settings: { runnerPool: { healthUrl: HEALTH, vmsUrl: VMS, token: { command: ['get-token'] }, owner: 'acme' } } })
    world.extra = argv => (argv[0] === 'get-token' ? { exitCode: 0, stdout: 'sekret\n' } : undefined)
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs.filter(a => a === 'get-token').length).toBe(1)
    expect(calls.fetches.find(f => f.url === VMS)?.headers).toEqual({ Authorization: 'Bearer sekret' })
    expect(calls.argvs.some(a => a.includes('repos/acme/widgets/actions/runs'))).toBe(true)
  })

  test('token from an environment variable goes through printenv', async ($, on) => {
    const { world, calls } = await boot($, on, { settings: { runnerPool: { healthUrl: HEALTH, vmsUrl: VMS, token: { env: 'POOL_TOKEN' } } } })
    world.extra = argv => (argv[0] === 'printenv' ? { exitCode: 0, stdout: 'abc' } : undefined)
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs).toContain('printenv POOL_TOKEN')
    expect(calls.fetches.find(f => f.url === VMS)?.headers).toEqual({ Authorization: 'Bearer abc' })
  })
})

describe('repo identity and owner', () => {
  test('remote forms', () => {
    expect(parseRemote('https://github.com/acme/widgets.git')).toBe('acme/widgets')
    expect(parseRemote(`https://user${AT}github.com/acme/widgets`)).toBe('acme/widgets')
    expect(parseRemote(`git${AT}github.com:acme/widgets.git`)).toBe('acme/widgets')
    expect(parseRemote(`ssh://git${AT}github.com/acme/my.repo.git`)).toBe('acme/my.repo')
    expect(parseRemote('https://gitlab.com/acme/widgets.git')).toBeNull()
  })

  test('gh answer wins, an invalid one falls back to the remote', async ($, on) => {
    const a = await boot($, on)
    a.world.repoView = { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: 'real/name', url: 'https://github.com/real/name' }) }
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    expect(a.calls.argvs.some(x => x.includes('run list -R real/name'))).toBe(true)
    await ui.unmount()
  })

  test('invalid nameWithOwner uses the remote', async ($, on) => {
    const { world, calls } = await boot($, on)
    world.repoView = { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: 'bad name/x' }) }
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs.some(x => x.includes('run list -R acme/widgets'))).toBe(true)
  })

  test('outside a repo the signed-in user is the owner, looked up once', async ($, on) => {
    const { world, calls } = await boot($, on, { repo: false })
    world.extra = argv => {
      if (argv[1] === 'api' && argv[2] === 'user') return { exitCode: 0, stdout: 'octo\n' }
      if (argv[1] === 'repo' && argv[2] === 'list') return { exitCode: 0, stdout: JSON.stringify([{ nameWithOwner: 'octo/a', pushedAt: '2026-10-01T00:00:00Z' }]) }
      return undefined
    }
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs.filter(a => a.includes('api user')).length).toBe(1)
    expect(calls.argvs.some(a => a.includes('repo list octo'))).toBe(true)
    expect((await texts(ui, /No GitHub repo in this folder/)).length).toBe(1)
  })

  test('inside a repo the repo owner is used', async ($, on) => {
    const { calls } = await boot($, on)
    const ui = await pane($)
    await ui.press({ key: 'act-all' })
    expect(calls.argvs.some(a => a.includes('repo list acme'))).toBe(true)
    expect(calls.argvs.some(a => a.includes('api user'))).toBe(false)
  })
})

describe('gh state', () => {
  test('missing gh is probed once and shown once', async ($, on) => {
    const { world, calls } = await boot($, on)
    world.ghVersion = 1
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs.filter(a => a.endsWith('--version')).length).toBe(3)
    expect((await texts(ui, /cli\.github\.com/)).length).toBe(1)
    expect(calls.toasts).toEqual([])
  })

  test('not signed in is probed once and shown once, also in Issues', async ($, on) => {
    const { world, calls } = await boot($, on)
    world.extra = argv => (argv[1] === 'auth' ? { exitCode: 1 } : undefined)
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs.filter(a => a.includes('auth status')).length).toBe(1)
    expect((await texts(ui, /gh auth login/)).length).toBe(1)
    await ui.press({ key: 'tab-issues' })
    expect((await texts(ui, /gh auth login/)).length).toBe(1)
  })

  test('an invalid token of an inactive account does not count as signed out', async ($, on) => {
    const { world, calls } = await boot($, on)
    world.extra = argv => (argv[1] === 'auth' ? { exitCode: argv.includes('--active') ? 0 : 1 } : undefined)
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    expect(calls.argvs.some(a => a.includes('auth status --active'))).toBe(true)
    expect((await texts(ui, /gh auth login/)).length).toBe(0)
  })

  test('gh without --active falls back to the plain probe', async ($, on) => {
    const { world } = await boot($, on)
    world.extra = argv =>
      argv[1] === 'auth' ? (argv.includes('--active') ? { exitCode: 1, stderr: 'unknown flag: --active' } : { exitCode: 0 }) : undefined
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    expect((await texts(ui, /gh auth login/)).length).toBe(0)
  })
})

describe('opener', () => {
  const open = async ($: Engine, on: On, env: Record<string, string>, uname?: string) => {
    const { world, calls } = await boot($, on, { env })
    world.runs = [run(1, 'completed', 'success')]
    const prev = world.extra
    world.extra = argv => (argv[1] === 'run' && argv[2] === 'view' ? { exitCode: 0, stdout: JSON.stringify({ databaseId: 1, name: 'ci', displayTitle: 't', event: 'push', headBranch: 'feat/x', headSha: 'abcdef123', status: 'completed', conclusion: 'success', createdAt: '2026-10-15T11:00:00Z', updatedAt: '2026-10-15T11:05:00Z', url: 'https://github.com/acme/widgets/actions/runs/1', jobs: [] }) } : prev(argv))
    const withView = world.extra
    if (uname) world.extra = argv => (argv[0] === 'uname' ? { exitCode: 0, stdout: `${uname}\n` } : withView(argv))
    const ui = await pane($)
    await ui.press({ key: 'act-refresh' })
    await ui.press({ key: 'run-open-1' })
    await ui.press({ key: 'run-web' })
    return calls.argvs.filter(a => /^(open|xdg-open|cmd) /.test(a))
  }

  test('macOS', async ($, on) => {
    expect(await open($, on, {}, 'Darwin')).toEqual(['open https://github.com/acme/widgets/actions/runs/1'])
  })
  test('Linux', async ($, on) => {
    expect(await open($, on, {}, 'Linux')).toEqual(['xdg-open https://github.com/acme/widgets/actions/runs/1'])
  })
  test('Windows', async ($, on) => {
    expect(await open($, on, { OS: 'Windows_NT' })).toEqual(['cmd /c start  https://github.com/acme/widgets/actions/runs/1'])
  })
})

describe('workflow dispatch ref', () => {
  const dispatch = async ($: Engine, on: On, setup: (w: World) => void) => {
    const { world, calls } = await boot($, on)
    world.extra = argv => (argv[1] === 'workflow' && argv[2] === 'list' ? { exitCode: 0, stdout: JSON.stringify([{ id: 7, name: 'ci', path: '.github/workflows/ci.yml', state: 'active' }]) } : undefined)
    setup(world)
    const ui = await pane($)
    await ui.press({ key: 'act-workflows' })
    await ui.press({ key: 'wf-run-7' })
    await ui.press({ key: 'wf-run-7' })
    return calls.argvs.find(a => a.includes('workflow run'))
  }

  test('current branch', async ($, on) => {
    expect(await dispatch($, on, () => undefined)).toContain('--ref=feat/x')
  })
  test('detached HEAD uses the default branch of the repo', async ($, on) => {
    const found = await dispatch($, on, w => {
      w.branch = ''
      const prev = w.extra
      w.extra = argv => (argv[1] === 'repo' && argv[2] === 'view' && argv[3] === 'acme/widgets' ? { exitCode: 0, stdout: 'trunk\n' } : prev(argv))
    })
    expect(found).toContain('--ref=trunk')
  })
  test('no ref known: none is passed', async ($, on) => {
    const found = await dispatch($, on, w => { w.branch = '' })
    expect(found).not.toContain('--ref')
  })
})

describe('rate limit', () => {
  test('the poll backs off, shows it inline and recovers', async ($, on) => {
    const { world, calls, clock } = await boot($, on, { interactive: true, stderr: 'API rate limit exceeded for user' })
    const polls = () => calls.argvs.filter(a => a.includes('run list')).length
    await clock.advance(1)
    const first = polls()
    expect(first).toBeGreaterThan(0)
    await clock.advance(90_000)
    expect(polls()).toBe(first)
    await clock.advance(90_000)
    expect(polls()).toBe(first + 1)
    await clock.advance(270_000)
    expect(polls()).toBe(first + 1)
    const ui = await pane($)
    expect((await texts(ui, /rate limit reached/)).length).toBe(1)
    world.stderr = ''
    await ui.press({ key: 'act-refresh' })
    expect((await texts(ui, /rate limit reached/)).length).toBe(0)
    const after = polls()
    await clock.advance(90_000)
    expect(polls()).toBe(after + 1)
  })
})

describe('run-end notification', () => {
  const notifying = async ($: Engine, on: On, opts: Opts, isSent = true) => {
    const sent: string[] = []
    const b = await boot($, on, { interactive: true, ...opts })
    b.world.notify = text => {
      sent.push(text)
      return isSent
    }
    return { ...b, sent }
  }

  test('once on the transition, nothing for runs completed at the first poll', async ($, on) => {
    const { world, clock, sent } = await notifying($, on, {})
    world.runs = [run(1, 'in_progress', null), run(2, 'completed', 'failure')]
    await clock.advance(90_000)
    expect(sent).toEqual([])
    world.runs = [run(1, 'completed', 'success'), run(2, 'completed', 'failure')]
    await clock.advance(90_000)
    expect(sent).toEqual(['✓ ci passed on feat/x · 5m00s'])
    await clock.advance(180_000)
    expect(sent.length).toBe(1)
  })

  test('a short run that starts and ends between two polls is announced', async ($, on) => {
    const { world, clock, sent } = await notifying($, on, {})
    await clock.advance(90_000)
    world.runs = [{ ...run(7, 'completed', 'success'), createdAt: '2026-10-15T12:00:30Z', startedAt: '2026-10-15T12:00:30Z', updatedAt: '2026-10-15T12:01:30Z' }]
    await clock.advance(90_000)
    expect(sent).toEqual(['✓ ci passed on feat/x · 1m00s'])
  })

  test('other branches are ignored', async ($, on) => {
    const { world, clock, sent } = await notifying($, on, {})
    world.runs = [run(1, 'in_progress', null, 'other')]
    await clock.advance(90_000)
    world.runs = [run(1, 'completed', 'failure', 'other')]
    await clock.advance(90_000)
    expect(sent).toEqual([])
  })

  test('toast when no channel sent it', async ($, on) => {
    const { world, calls, clock, sent } = await notifying($, on, {}, false)
    world.runs = [run(1, 'queued', null)]
    await clock.advance(90_000)
    world.runs = [run(1, 'completed', 'failure')]
    await clock.advance(90_000)
    expect(sent).toEqual(['✗ ci failed on feat/x · 5m00s'])
    expect(calls.toasts).toContain('✗ ci failed on feat/x · 5m00s')
  })

  test('setting off: nothing', async ($, on) => {
    const { world, clock, sent } = await notifying($, on, { settings: { notifyRunEnd: false } })
    world.runs = [run(1, 'in_progress', null)]
    await clock.advance(90_000)
    world.runs = [run(1, 'completed', 'success')]
    await clock.advance(90_000)
    expect(sent).toEqual([])
  })

  test('texts', () => {
    expect(runEndText('ci', 'main', 'cancelled', 61_000)).toBe('⊘ ci cancelled on main · 1m01s')
    expect(runEndText('ci', 'main', 'skipped', 1000)).toBeNull()
  })
})
