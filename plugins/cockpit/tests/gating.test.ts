import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_CONFIG } from '../hooks/defaults'
import type { Redirect } from '../hooks/sources'

// Gating and the sources pane through the engine: the mod's hooks, atoms and render hook are real, only the
// engine operations underneath are fake. Files live in a map.
const HOME = '/preview'
const COCKPIT = `${HOME}/.claude/cockpit/cockpit.json`
const BACKUP = `${COCKPIT}.bak-v2`
const BROWSER_HINT = 'Use the Playwright MCP instead'
const REDIRECTS: Redirect[] = [
  { match: String.raw`\bnpx\s+(-y\s+)?docs-cli\b`, sources: ['mcp:context7'] },
  { match: String.raw`\b(curl|wget|http)\b.*api\.example\.com`, sources: ['mcp:claude_ai_Calendar'] },
  { match: String.raw`\b(curl|wget|http)\b.*(wttr\.in|open-meteo\.com)`, sources: ['mcp:claude_ai_Weather'] },
]
// Tests assume that sources without an entry are "off"
const SETTINGS = { ...DEFAULT_CONFIG.settings, openOnStart: false, demo: true, defaultState: 'off' as const }

const INSTRUCTIONS = [
  '# MCP Server Instructions',
  '',
  'The following MCP servers have provided instructions for how to use their tools and resources:',
  '',
  '## claude.ai Calendar',
  'Calendar assistant.',
  '',
  '## claude.ai Notes',
  'Notes helper.',
  '',
  '## context7',
  'Use this server to fetch current documentation.',
  '',
  '## cockpit',
  'Tools registered by the cockpit plugin.',
  '',
  '# Another heading',
  'Stays.',
].join('\n')

type Skill = { name: string; source: string; plugin?: string }
type Opts = {
  files?: Record<string, string>
  tools?: Array<{ name: string; mcp: boolean }>
  skills?: Skill[]
  isInteractive?: boolean
  columns?: number
  // What settings.json holds per scope (user, project, local)
  scopes?: Partial<Record<'user' | 'project' | 'local', Record<string, boolean>>>
}
type Calls = { toasts: string[]; writes: string[]; statuses: string[]; files: Record<string, string>; ui: Pane }

const config = (states: Record<string, string>, hints: Record<string, string> = {}) =>
  JSON.stringify({ ...DEFAULT_CONFIG, states, hints, redirects: REDIRECTS, settings: SETTINGS })

async function boot($: Engine, on: On, opts: Opts = {}): Promise<Calls> {
  const calls = { toasts: [] as string[], writes: [] as string[], statuses: [] as string[], ui: undefined as unknown as Pane, files: { ...(opts.files ?? { [COCKPIT]: JSON.stringify({ ...DEFAULT_CONFIG, settings: SETTINGS }) }) } }
  mock.store(on)
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { HOME })
  on('fs.exists', async (_, e) => ({ value: e.path in calls.files }))
  on('fs.read', async (_, e) => ({ value: calls.files[e.path] ?? '' }))
  on('fs.write', async (_, e) => {
    calls.files[e.path] = e.text
    // Saves go through a temp file and mv: only the final path counts as a write
    if (!e.path.endsWith('.tmp')) calls.writes.push(e.path)
    return { value: undefined }
  })
  on('settings.read', async (_, e) => {
    const source = (e as { source?: 'user' | 'project' | 'local' }).source
    const scopes = opts.scopes ?? {}
    const merged = Object.assign({}, ...Object.values(scopes))
    return { value: { enabledPlugins: source ? (scopes[source] ?? {}) : merged } }
  })
  on('command.list', async () => ({ value: (opts.skills ?? []) as never }))
  on('tool.list', async () => ({ value: (opts.tools ?? []) as never }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async (_, e) => {
    calls.statuses.push(String(e.text))
    return { value: undefined }
  })
  on('ui.toast', async (_, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.log', async () => ({ value: undefined }))
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  on('session.root', async () => ({ value: '/r' }))
  on('session.repo', async () => ({ value: null }))
  on('command.register', async (_, e) => ({ value: { command: e.name } }))
  on('tool.register', async (_, e) => ({ value: { tool: `mcp__cockpit__${e.name}` } }))
  on('session.start', async (_, e) => e)
  // gh exists (otherwise its note overwrites the config's), everything else fails quietly
  on('process.run', async (_, e) => {
    const [cmd, , from, to] = e.argv
    if (cmd === 'mv' && from && to) {
      calls.files[to] = calls.files[from] ?? ''
      delete calls.files[from]
      calls.writes.push(to)
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: e.argv.includes('--version') ? 0 : 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.check', async () => ({ decision: 'allow' }))
  on('prompt.section', async (_, e) => ({ text: e.text }))
  on('tool.describe', async (_, e) => ({ description: (e as { description?: string }).description ?? '' }) as never)
  on('prompt.attachment', async (_, e) => ({ text: e.text }))
  on('prompt.submit', async (_, e) => ({ text: e.text }))
  on('agent.offer', async () => ({ isOffered: true }))
  const started = $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: opts.isInteractive ?? true } as never)
  // A file that does not parse is read once more after a pause
  await clock.settle()
  await clock.advance(200)
  await started
  // The pane is up from the start; pressing the tab ends all loading of the session (sources are known)
  calls.ui = await openPane($, opts.columns)
  await calls.ui.press({ key: 'tab-sources' })
  return calls
}

type Pane = Awaited<ReturnType<typeof openPane>>

async function openPane($: Engine, columns = 100) {
  return $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: { title: 'Cockpit', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  } as never)
}

const CALENDAR = { name: 'mcp__claude_ai_Calendar__sleep', mcp: true }
const check = ($: Engine, tool: string, input: Record<string, unknown> = {}) => $.tool.check({ tool, input })
const describeTool = ($: Engine, tool: string) =>
  $.tool.describe({ tool, description: 'Description', provider: { kind: 'engine' } } as never) as Promise<{ description?: string; isDeferred?: boolean }>
const section = ($: Engine, text = INSTRUCTIONS) => $.prompt.section({ name: 'mcp_instructions', text }).then(r => String(r.text))
const say = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)

describe('Config at start', () => {
  const V2 = JSON.stringify({
    version: 2,
    settings: { ciEverySec: 60 },
    states: { 'skill:docs-lookup': 'an', 'mcp:claude_ai_Notes': 'nie', 'plugin:superpowers': 'aus' },
    folders: { '/r': { 'plugin:superpowers': 'an' } },
    hints: { 'mcp:claude_ai_Notes': 'Use Calendar.' },
    redirects: REDIRECTS,
    startupMarkers: { superpowers: 'You have superpowers' },
  })

  test('format 2 is written as format 3, the original once as backup', async ($, on) => {
    const calls = await boot($, on, { files: { [COCKPIT]: V2 } })
    expect(calls.files[BACKUP]).toBe(V2)
    expect(calls.writes).toEqual([BACKUP, COCKPIT])
    const written = JSON.parse(calls.files[COCKPIT] ?? '{}')
    expect(written.version).toBe(3)
    expect(written.states).toEqual({ 'skill:docs-lookup': 'on', 'mcp:claude_ai_Notes': 'never', 'plugin:superpowers': 'off' })
    expect(written.folders).toEqual({ '/r': { 'plugin:superpowers': 'on' } })
    expect(written.settings.defaultState).toBe('off')
    expect(written.settings.ciEverySec).toBe(60)
  })

  test('format 2 does not overwrite an existing backup', async ($, on) => {
    const calls = await boot($, on, { files: { [COCKPIT]: V2, [BACKUP]: 'older' } })
    expect(calls.files[BACKUP]).toBe('older')
    expect(calls.writes).toEqual([COCKPIT])
  })

  test('format 2 is lifted in non-interactive sessions too', async ($, on) => {
    const calls = await boot($, on, { files: { [COCKPIT]: V2 }, isInteractive: false })
    expect(calls.writes).toEqual([BACKUP, COCKPIT])
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').version).toBe(3)
  })

  test('without a file cockpit.json is created from the neutral default', async ($, on) => {
    const calls = await boot($, on, { files: {} })
    expect(calls.writes).toEqual([COCKPIT])
    const written = JSON.parse(calls.files[COCKPIT] ?? '{}')
    expect(written.version).toBe(3)
    expect(written.settings.defaultState).toBe('on')
    expect(written.states).toEqual({})
  })

  test('without a file a non-interactive session writes nothing', async ($, on) => {
    const calls = await boot($, on, { files: {}, isInteractive: false })
    expect(calls.writes).toEqual([])
    expect(calls.files[COCKPIT]).toBeUndefined()
  })

  test('a broken cockpit.json is never overwritten', async ($, on) => {
    const calls = await boot($, on, { files: { [COCKPIT]: '{broken' } })
    expect(calls.writes).toEqual([])
    expect(calls.files[COCKPIT]).toBe('{broken')
    const ui = calls.ui
    expect(await ui.find({ type: 'Text', text: /cockpit\.json is not valid JSON/ })).toBeDefined()
  })

  test('unknown state in format 3: nothing written, note in the pane', async ($, on) => {
    const bad = JSON.stringify({ ...DEFAULT_CONFIG, states: { 'skill:a': 'maybe' } })
    const calls = await boot($, on, { files: { [COCKPIT]: bad } })
    expect(calls.writes).toEqual([])
    expect(calls.files[COCKPIT]).toBe(bad)
    expect(await calls.ui.find({ type: 'Text', text: /unknown values/ })).toBeDefined()
  })
})

describe('off: loads on first call', () => {
  test('MCP tool: deferred, free after the call, listed under "Loaded" with a counter', async ($, on) => {
    const calls = await boot($, on, { tools: [CALENDAR] })
    const ui = calls.ui

    const before = await describeTool($, CALENDAR.name)
    expect(before.isDeferred).toBe(true)
    expect(before.description).toBe('[Cockpit: off; loads on first call.] Description')
    const sec = await section($)
    expect(sec).not.toContain('Calendar assistant')
    expect(sec).toContain('(Cockpit: 2 MCP instructions hidden.')

    expect((await check($, CALENDAR.name)).decision).toBe('allow')
    expect(calls.toasts).toContain('Loaded: claude_ai_Calendar')
    expect((await describeTool($, CALENDAR.name)).description).toBe('Description')
    expect(await section($)).toContain('## claude.ai Calendar')
    expect(await ui.find({ type: 'Text', text: 'Loaded (this session)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^mcp:claude_ai_Calendar\s*$/ })).toBeDefined()
    expect(calls.statuses.at(-1)).toMatch(/^Cockpit: \d+ on · 1 loaded/)

    // The second call counts
    await check($, 'mcp__claude_ai_Calendar__trends')
    await ui.press({ key: 'tab-sources' })
    expect(await ui.find({ type: 'Text', text: /^mcp:claude_ai_Calendar ×2/ })).toBeDefined()
    expect(calls.writes).toEqual([])
  })

  test('skill: only the called plugin skill loads, the tail lists only off names, never is missing', async ($, on) => {
    const skills: Skill[] = [
      { name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers' },
      { name: 'superpowers:writing-plans', source: 'plugin', plugin: 'superpowers' },
      { name: 'anthropic-skills:chrome-browser', source: 'plugin', plugin: 'anthropic-skills' },
      { name: 'docs-lookup', source: 'user' },
    ]
    const cfg = config({ 'skill:docs-lookup': 'on', 'skill:anthropic-skills:chrome-browser': 'never' })
    const calls = await boot($, on, { files: { [COCKPIT]: cfg }, skills })
    const listing = ['Skills:', '- superpowers:brainstorming: Ideas', '- superpowers:writing-plans: Plans', '- anthropic-skills:chrome-browser: Chrome', '- docs-lookup: Docs', '- simplify: Cleanup'].join('\n')
    const att = () => $.prompt.attachment({ type: 'skill_listing', text: listing, origin: { kind: 'engine' } } as never).then(r => String(r.text))

    const before = await att()
    expect(before).toContain('- docs-lookup: Docs')
    expect(before).toContain('- simplify: Cleanup')
    expect(before).not.toContain('- superpowers:brainstorming')
    expect(before).toContain('(Cockpit: off, loads when invoked via the Skill tool: superpowers:brainstorming, superpowers:writing-plans)')
    expect(before).not.toContain('chrome-browser')

    expect((await check($, 'Skill', { skill: 'superpowers:brainstorming' })).decision).toBe('allow')
    expect(calls.toasts).toContain('Loaded: superpowers:brainstorming')
    const after = await att()
    expect(after).toContain('- superpowers:brainstorming: Ideas')
    expect(after).toContain('(Cockpit: off, loads when invoked via the Skill tool: superpowers:writing-plans)')
  })

  test('an agent set to off stays offered and loads on call, one set to never is not offered', async ($, on) => {
    const cfg = JSON.stringify({ ...DEFAULT_CONFIG, states: { 'agent:blocker': 'never', 'agent:scout': 'on' }, settings: SETTINGS })
    const calls = await boot($, on, { files: { [COCKPIT]: cfg } })
    const offer = (agent: string, source = 'user') => $.agent.offer({ agent, description: 'x', source, provider: { kind: 'engine' } } as never).then(r => r.isOffered)

    expect(await offer('scout')).toBe(true)
    expect(await offer('sandbox')).toBe(true)
    expect(await offer('blocker')).toBe(false)
    expect(await offer('Explore', 'built-in')).toBe(true)

    // the offered off agent loads on call, the never agent is denied
    expect((await check($, 'Agent', { subagent_type: 'sandbox' })).decision).toBe('allow')
    expect(calls.toasts).toContain('Loaded: sandbox')
    const denied = await check($, 'Agent', { subagent_type: 'blocker' })
    expect(denied.decision).toBe('deny')
    expect(denied.reason).toContain('Agent blocker is set to "never"')
  })

  test('naming a source in the prompt loads off sources, never is ignored', async ($, on) => {
    const cfg = config({ 'mcp:claude_ai_Notes': 'never' })
    const calls = await boot($, on, { files: { [COCKPIT]: cfg }, tools: [CALENDAR, { name: 'mcp__claude_ai_Notes__geocode', mcp: true }] })
    await say($, 'show me ;calendar and ;notes please')
    expect(calls.toasts).toContain('Loaded on request: claude_ai_Calendar')
    expect((await check($, CALENDAR.name)).decision).toBe('allow')
    expect((await check($, 'mcp__claude_ai_Notes__geocode')).decision).toBe('deny')
  })

  test('non-interactive runs never filter', async ($, on) => {
    await boot($, on, { tools: [CALENDAR], isInteractive: false })
    expect((await describeTool($, CALENDAR.name)).isDeferred).toBeUndefined()
    expect(await section($)).toBe(INSTRUCTIONS)
    expect((await check($, CALENDAR.name)).decision).toBe('allow')
  })
})

describe('never: does not load', () => {
  test('skill and MCP server are denied with the hint, also against a plugin grant', async ($, on) => {
    const cfg = config(
      { 'skill:anthropic-skills:chrome-browser': 'never', 'mcp:claude_ai_Notes': 'never' },
      { 'skill:anthropic-skills:chrome-browser': BROWSER_HINT, 'mcp:claude_ai_Notes': 'Planning goes through Calendar.' },
    )
    const skills: Skill[] = [{ name: 'anthropic-skills:chrome-browser', source: 'plugin', plugin: 'anthropic-skills' }]
    const calls = await boot($, on, { files: { [COCKPIT]: cfg }, skills })

    const skill = await check($, 'Skill', { skill: 'anthropic-skills:chrome-browser' })
    expect(skill.decision).toBe('deny')
    expect(skill.reason).toContain('Skill anthropic-skills:chrome-browser is set to "never". Use the Playwright MCP instead')
    expect(skill.reason?.endsWith('instead. Do not work around it.')).toBe(true)

    const mcp = await check($, 'mcp__claude_ai_Notes__geocode')
    expect(mcp.decision).toBe('deny')
    expect(mcp.reason).toBe('Cockpit: mcp__claude_ai_Notes__geocode is set to "never". Planning goes through Calendar. Do not work around it.')
    expect((await describeTool($, 'mcp__claude_ai_Notes__geocode')).description).toBe('[Cockpit: never – Planning goes through Calendar.] Description')
    expect(calls.toasts.filter(text => text.startsWith('Loaded'))).toEqual([])

    // No entry under "Loaded", not even after naming it in the prompt
    await say($, 'nimm ;notes')
    expect((await check($, 'mcp__claude_ai_Notes__geocode')).decision).toBe('deny')
  })

  test('a Bash detour skips never sources and otherwise loads the first, without re-granting on sources', async ($, on) => {
    const cfg = config({ 'mcp:claude_ai_Calendar': 'never', 'mcp:claude_ai_Weather': 'off', 'mcp:context7': 'on' })
    const calls = await boot($, on, {
      files: { [COCKPIT]: cfg },
      tools: [CALENDAR, { name: 'mcp__claude_ai_Weather__forecast', mcp: true }, { name: 'mcp__context7__query-docs', mcp: true }],
    })
    const ui = calls.ui
    await ui.press({ key: 'tab-sources' })

    // Calendar is never: no detour, plain Bash
    const calendar = await check($, 'Bash', { command: 'curl -s https://api.example.com/events' })
    expect(calendar.reason ?? '').not.toContain('Cockpit')
    // Weather is off: stopped and loaded
    const weather = await check($, 'Bash', { command: 'curl https://wttr.in/Berlin' })
    expect(weather.decision).toBe('deny')
    expect(weather.reason).toContain('mcp__claude_ai_Weather__')
    expect((await check($, 'mcp__claude_ai_Weather__forecast')).decision).toBe('allow')
    // context7 is on: only deny, load nothing
    const before = calls.toasts.length
    const ctx = await check($, 'Bash', { command: 'npx -y docs-cli docs react' })
    expect(ctx.decision).toBe('deny')
    expect(calls.toasts.length).toBe(before)
    // plain Bash stays untouched
    expect((await check($, 'Bash', { command: 'npx playwright test' })).reason ?? '').not.toContain('Cockpit')
  })

  test('plugin set to never: child without an entry is never, plugin agent is not offered', async ($, on) => {
    const cfg = config({ 'plugin:cloudflare': 'never' }, { 'plugin:cloudflare': 'Use wrangler in the terminal' })
    const skills: Skill[] = [{ name: 'cloudflare:wrangler', source: 'plugin', plugin: 'cloudflare' }]
    await boot($, on, { files: { [COCKPIT]: cfg }, skills })
    const r = await check($, 'Skill', { skill: 'cloudflare:wrangler' })
    expect(r.decision).toBe('deny')
    expect(r.reason).toContain('Use wrangler in the terminal.')
    const offered = await $.agent.offer({ agent: 'cloudflare:builder', description: 'x', source: 'plugin', provider: { kind: 'plugin', plugin: 'cloudflare' } } as never)
    expect(offered.isOffered).toBe(false)
  })
})

describe('Pane: Sources', () => {
  test('clicking "on" writes cockpit.json, the state is in the file', async ($, on) => {
    const calls = await boot($, on, { tools: [CALENDAR] })
    const ui = calls.ui
    await ui.press({ key: 'tab-sources' })
    const variant = async (key: string) => (await ui.find({ type: 'Button', key }))?.props['variant']

    expect(await variant('src-mcp:claude_ai_Calendar-off')).toBe('primary')
    expect(await variant('src-mcp:claude_ai_Calendar-on')).toBe('secondary')
    await ui.press({ key: 'src-mcp:claude_ai_Calendar-on' })
    expect(await variant('src-mcp:claude_ai_Calendar-on')).toBe('primary')
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').states['mcp:claude_ai_Calendar']).toBe('on')
    expect(calls.writes.every(p => p === COCKPIT)).toBe(true)
    expect((await describeTool($, CALENDAR.name)).isDeferred).toBeUndefined()

    await ui.press({ key: 'src-mcp:claude_ai_Calendar-never' })
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').states['mcp:claude_ai_Calendar']).toBe('never')
    expect((await check($, CALENDAR.name)).decision).toBe('deny')
    expect(await ui.find({ type: 'Text', text: '⊘' })).toBeDefined()
  })

  test('"keep on" sets the state and removes the row from "Loaded", "undo" blocks again', async ($, on) => {
    const calls = await boot($, on, { tools: [CALENDAR, { name: 'mcp__claude_ai_Weather__forecast', mcp: true }] })
    const ui = calls.ui
    await check($, CALENDAR.name)
    await check($, 'mcp__claude_ai_Weather__forecast')
    await ui.press({ key: 'tab-sources' })
    expect(await ui.find({ type: 'Text', text: 'Loaded (this session)' })).toBeDefined()

    await ui.press({ key: 'load-keep-mcp:claude_ai_Calendar' })
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').states['mcp:claude_ai_Calendar']).toBe('on')
    expect(await ui.find({ type: 'Button', key: 'load-keep-mcp:claude_ai_Calendar' })).toBeUndefined()
    expect((await check($, CALENDAR.name)).decision).toBe('allow')

    await ui.press({ key: 'load-drop-mcp:claude_ai_Weather' })
    expect(await ui.find({ type: 'Text', text: 'Loaded (this session)' })).toBeUndefined()
    expect((await describeTool($, 'mcp__claude_ai_Weather__forecast')).isDeferred).toBe(true)
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').states['mcp:claude_ai_Weather']).toBeUndefined()
  })

  test('a plugin unfolds: children inherit (dimmed, "(plugin)"), own click and ↺', async ($, on) => {
    const skills: Skill[] = [
      { name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers' },
      { name: 'superpowers:writing-plans', source: 'plugin', plugin: 'superpowers' },
    ]
    const calls = await boot($, on, {
      skills,
      tools: [{ name: 'mcp__plugin_superpowers_x__t', mcp: true }],
      scopes: { user: { 'superpowers@official': true } },
    })
    const ui = calls.ui
    await ui.press({ key: 'tab-sources' })
    const btn = (key: string) => ui.find({ type: 'Button', key })

    expect(await btn('src-skill:superpowers:brainstorming-on')).toBeUndefined()
    await ui.press({ key: 'src-fold-plugin:superpowers' })
    const inherited = await btn('src-skill:superpowers:brainstorming-off')
    expect(inherited?.props['variant']).toBe('primary')
    expect(inherited?.props['dimColor']).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^brainstorming \(plugin\)/ })).toBeDefined()
    expect(await btn('src-mcp:plugin_superpowers_x-off')).toBeDefined()

    await ui.press({ key: 'src-skill:superpowers:brainstorming-on' })
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').states['skill:superpowers:brainstorming']).toBe('on')
    expect((await btn('src-skill:superpowers:brainstorming-on'))?.props['dimColor']).toBe(false)
    expect(await btn('src-skill:superpowers:writing-plans-off')).toBeDefined()

    await ui.press({ key: 'src-reset-skill:superpowers:brainstorming' })
    expect(JSON.parse(calls.files[COCKPIT] ?? '{}').states['skill:superpowers:brainstorming']).toBeUndefined()
    expect((await btn('src-skill:superpowers:brainstorming-off'))?.props['dimColor']).toBe(true)
  })

  test('a repo plugin without an entry is on and carries the mark', async ($, on) => {
    const { ui } = await boot($, on, { scopes: { project: { 'flowkit@x': true }, user: { 'superpowers@y': true } } })
    expect((await ui.find({ type: 'Button', key: 'src-plugin:flowkit-on' }))?.props['variant']).toBe('primary')
    expect((await ui.find({ type: 'Button', key: 'src-plugin:superpowers-off' }))?.props['variant']).toBe('primary')
    expect(await ui.find({ type: 'Text', text: 'Repo' })).toBeDefined()
  })

  test('this folder: buttons set only here, global shows "here ...", ↺ deletes the deviation', async ($, on) => {
    const calls = await boot($, on, { scopes: { user: { 'superpowers@official': true } } })
    const ui = calls.ui
    const btn = (key: string) => ui.find({ type: 'Button', key })
    const saved = () => JSON.parse(calls.files[COCKPIT] ?? '{}')

    await ui.press({ key: 'scope-folder' })
    expect((await btn('scope-folder'))?.props['variant']).toBe('primary')
    // Without a deviation the folder view shows the global state dimmed
    expect((await btn('src-plugin:superpowers-off'))?.props['dimColor']).toBe(true)

    await ui.press({ key: 'src-plugin:superpowers-on' })
    expect(saved().folders).toEqual({ '/r': { 'plugin:superpowers': 'on' } })
    expect(saved().states['plugin:superpowers']).toBeUndefined()
    expect((await btn('src-plugin:superpowers-on'))?.props['dimColor']).toBe(false)
    expect(calls.statuses.at(-1)).toMatch(/^Cockpit: 1 on/)

    await ui.press({ key: 'scope-global' })
    expect((await btn('src-plugin:superpowers-off'))?.props['variant']).toBe('primary')
    expect(await ui.find({ type: 'Text', text: /superpowers · here on/ })).toBeDefined()

    await ui.press({ key: 'scope-folder' })
    await ui.press({ key: 'src-reset-plugin:superpowers' })
    expect(saved().folders).toEqual({})
  })

  test('/cockpit jobs (old name) opens the sources', async ($, on) => {
    const { ui } = await boot($, on)
    await ui.press({ key: 'tab-actions' })
    expect((await ui.find({ type: 'Button', key: 'tab-sources' }))?.props['variant']).toBe('secondary')
    await $.command.run({ origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 }, command: 'cockpit', args: 'jobs' } as never)
    expect((await ui.find({ type: 'Button', key: 'tab-sources' }))?.props['variant']).toBe('primary')
  })

  test('narrow pane: buttons move to their own line, all tabs render', async ($, on) => {
    const skills: Skill[] = [{ name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers' }]
    const { ui } = await boot($, on, { skills, tools: [CALENDAR], columns: 44, scopes: { user: { 'superpowers@official': true } } })
    await ui.press({ key: 'tab-sources' })
    await ui.press({ key: 'src-fold-plugin:superpowers' })
    for (const key of ['src-mcp:claude_ai_Calendar-never', 'src-plugin:superpowers-on', 'src-skill:superpowers:brainstorming-off']) {
      expect(await ui.find({ type: 'Button', key })).toBeDefined()
    }
    for (const tab of ['tab-settings', 'tab-help', 'tab-issues', 'tab-actions', 'tab-sources']) {
      await ui.press({ key: tab })
      expect(await ui.find({ type: 'Text', text: /This tab hit an error/ })).toBeUndefined()
    }
  })
})

describe('German locale', () => {
  test('pane text is German, model-facing denial text stays English', async ($, on) => {
    const cfg = JSON.stringify({ ...DEFAULT_CONFIG, states: { 'mcp:claude_ai_Notes': 'never', 'plugin:superpowers': 'on' }, redirects: REDIRECTS, settings: { ...SETTINGS, language: 'de' } })
    const skills: Skill[] = [{ name: 'superpowers:brainstorming', source: 'plugin', plugin: 'superpowers' }]
    const calls = await boot($, on, { files: { [COCKPIT]: cfg }, skills, tools: [CALENDAR], scopes: { user: { 'superpowers@official': true } } })
    const ui = calls.ui
    await check($, CALENDAR.name)
    await ui.press({ key: 'tab-sources' })
    expect(await ui.find({ type: 'Text', text: 'Nachgeladen (diese Session)' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'load-keep-mcp:claude_ai_Calendar' })).toBeDefined()
    await ui.press({ key: 'src-fold-plugin:superpowers' })
    expect(await ui.find({ type: 'Text', text: /^brainstorming \(Plugin\)/ })).toBeDefined()
    expect(calls.toasts).toContain('Nachgeladen: claude_ai_Calendar')

    const denied = await check($, 'mcp__claude_ai_Notes__geocode')
    expect(denied.reason).toBe('Cockpit: mcp__claude_ai_Notes__geocode is set to "never". Do not work around it.')
  })
})
