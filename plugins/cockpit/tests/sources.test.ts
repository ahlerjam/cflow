import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/defaults'
import {
  agentNameOf,
  agentOwner,
  clearFolderState,
  clearState,
  filterMcpInstructions,
  filterSkillListing,
  findRedirect,
  folderKey,
  groupSources,
  hintOf,
  loadSource,
  mergeKnown,
  lspAllowed,
  mcpOwner,
  mcpServerOf,
  neverReason,
  ownerOf,
  parseConfig,
  redirectHint,
  repoPlugins,
  requestedSources,
  setFolderState,
  setState,
  skillOwner,
  sourceSuggestions,
  stateOf,
} from '../hooks/sources'
import { configErrorText, describeSuggestion, t } from '../hooks/i18n'
import { S } from '../hooks/state'
import type { CockpitConfig, Owner, SourceKind, State } from '../hooks/sources'

const BROWSER_HINT = 'Use the Playwright MCP instead'

// Most cases assume that sources without an entry are "off"
const cfgWith = (states: Record<string, State>, hints: Record<string, string> = {}): CockpitConfig => ({
  ...DEFAULT_CONFIG,
  settings: { ...DEFAULT_CONFIG.settings, defaultState: 'off' },
  states,
  hints,
})

const plugin = (name: string, skill?: string, server?: string): Owner => ({ kind: 'plugin', name, ...(skill ? { skill } : {}), ...(server ? { server } : {}) })

describe('resolver stateOf', () => {
  test('plugin on, child never: the child stays never', () => {
    const cfg = cfgWith({ 'plugin:superpowers': 'on', 'skill:superpowers:brainstorming': 'never' })
    const r = stateOf(cfg, plugin('superpowers', 'superpowers:brainstorming'), [], [])
    expect(r).toEqual({ saved: 'never', effective: 'never', via: 'own', isFolder: false })
    expect(stateOf(cfg, plugin('superpowers', 'superpowers:writing-plans')).effective).toBe('on')
  })

  test('plugin off, child on: the child is on, siblings stay off', () => {
    const cfg = cfgWith({ 'plugin:superpowers': 'off', 'skill:superpowers:brainstorming': 'on' })
    expect(stateOf(cfg, plugin('superpowers', 'superpowers:brainstorming'))).toEqual({ saved: 'on', effective: 'on', via: 'own', isFolder: false })
    expect(stateOf(cfg, plugin('superpowers', 'superpowers:writing-plans'))).toEqual({ saved: 'off', effective: 'off', via: 'plugin' , isFolder: false })
  })

  test('plugin never, child without an entry: never, also against a session grant of the plugin', () => {
    const cfg = cfgWith({ 'plugin:cloudflare': 'never' })
    const child = plugin('cloudflare', 'cloudflare:wrangler')
    expect(stateOf(cfg, child)).toEqual({ saved: 'never', effective: 'never', via: 'plugin' , isFolder: false })
    expect(stateOf(cfg, child, ['plugin:cloudflare', 'skill:cloudflare:wrangler']).effective).toBe('never')
    expect(stateOf(cfg, plugin('cloudflare'), ['plugin:cloudflare']).effective).toBe('never')
  })

  test('calling a plugin skill while the plugin is off loads only that skill', () => {
    const cfg = cfgWith({ 'plugin:superpowers': 'off' })
    const skill = plugin('superpowers', 'superpowers:brainstorming')
    const grants = [loadSource(skill)]
    expect(grants).toEqual(['skill:superpowers:brainstorming'])
    expect(stateOf(cfg, skill, grants)).toEqual({ saved: 'off', effective: 'on', via: 'session' , isFolder: false })
    expect(stateOf(cfg, plugin('superpowers', 'superpowers:writing-plans'), grants).effective).toBe('off')
    expect(stateOf(cfg, plugin('superpowers'), grants).effective).toBe('off')
  })

  test('a grant of the plugin lifts its off children, an MCP server loads its plugin', () => {
    const cfg = cfgWith({})
    const server = mcpOwner('plugin_playwright_playwright', ['playwright@claude-plugins-official'])
    expect(server).toEqual({ kind: 'plugin', name: 'playwright', server: 'plugin_playwright_playwright' })
    expect(loadSource(server)).toBe('plugin:playwright')
    expect(stateOf(cfg, server).effective).toBe('off')
    expect(stateOf(cfg, server, ['plugin:playwright'])).toEqual({ saved: 'off', effective: 'on', via: 'session' , isFolder: false })
  })

  test('a session grant lifts off, never stays never', () => {
    const cfg = cfgWith({ 'mcp:context7': 'never', 'skill:release-notes': 'on' })
    expect(stateOf(cfg, { kind: 'mcp', server: 'claude_ai_Calendar' }, ['mcp:claude_ai_Calendar'])).toEqual({ saved: 'off', effective: 'on', via: 'session' , isFolder: false })
    expect(stateOf(cfg, { kind: 'mcp', server: 'context7' }, ['mcp:context7']).effective).toBe('never')
    expect(stateOf(cfg, { kind: 'skill', name: 'release-notes' }, [])).toEqual({ saved: 'on', effective: 'on', via: 'own', isFolder: false })
    // Spelling of the grant does not matter
    expect(stateOf(cfg, { kind: 'mcp', server: 'claude_ai_Calendar' }, ['mcp:CLAUDE_AI_calendar']).effective).toBe('on')
  })

  test('a project-scope plugin without an entry is on, with an entry the entry applies', () => {
    const cfg = cfgWith({})
    expect(stateOf(cfg, plugin('flowkit'), [], ['flowkit'])).toEqual({ saved: 'on', effective: 'on', via: 'default', isFolder: false })
    expect(stateOf(cfg, plugin('flowkit', 'flowkit:plan'), [], ['flowkit']).effective).toBe('on')
    expect(stateOf(cfg, plugin('superpowers'), [], ['flowkit']).effective).toBe('off')
    expect(stateOf(cfgWith({ 'plugin:flowkit': 'off' }), plugin('flowkit'), [], ['flowkit']).effective).toBe('off')
  })

  test('cockpit itself is always on', () => {
    const cfg = cfgWith({ 'plugin:cockpit': 'never', 'mcp:cockpit': 'never' })
    expect(stateOf(cfg, plugin('cockpit')).effective).toBe('on')
    expect(stateOf(cfg, { kind: 'mcp', server: 'cockpit' }).effective).toBe('on')
    expect(stateOf(cfg, plugin('cockpit', 'cockpit:x')).effective).toBe('on')
  })

  test('sources without an entry follow settings.defaultState', () => {
    const server: Owner = { kind: 'mcp', server: 'claude_ai_Calendar' }
    expect(DEFAULT_CONFIG.settings.defaultState).toBe('on')
    expect(DEFAULT_CONFIG.states).toEqual({})
    expect(stateOf(DEFAULT_CONFIG, server)).toEqual({ saved: 'on', effective: 'on', via: 'default', isFolder: false })
    expect(stateOf(cfgWith({}), server)).toEqual({ saved: 'off', effective: 'off', via: 'default', isFolder: false })
    // a plugin child inherits from the plugin, not from the default
    const off = { ...DEFAULT_CONFIG, states: { 'plugin:a': 'off' as State } }
    expect(stateOf(off, plugin('a', 'a:b'))).toEqual({ saved: 'off', effective: 'off', via: 'plugin', isFolder: false })
    // repo plugins without an entry are on, also with defaultState off
    expect(stateOf(cfgWith({}), plugin('flowkit'), [], ['flowkit']).effective).toBe('on')
  })

  test('setting a state and clearing a child entry', () => {
    const on = setState(DEFAULT_CONFIG, 'mcp:claude_ai_Calendar', 'on')
    expect(stateOf(on, { kind: 'mcp', server: 'claude_ai_Calendar' }).effective).toBe('on')
    const again = setState(on, 'mcp:CLAUDE_AI_CALENDAR', 'never')
    expect(Object.keys(again.states).filter(k => k.toLowerCase().includes('calendar'))).toEqual(['mcp:CLAUDE_AI_CALENDAR'])
    const child = setState(cfgWith({ 'plugin:a': 'off' }), 'skill:a:b', 'on')
    expect(stateOf(clearState(child, 'skill:a:b'), plugin('a', 'a:b')).via).toBe('plugin')
  })

  test('the hint comes from the child, else from the plugin; the denial has no double period', () => {
    const cfg = cfgWith({}, { 'skill:anthropic-skills:chrome-browser': BROWSER_HINT, 'plugin:x': 'Use y' })
    expect(hintOf(cfg, plugin('anthropic-skills', 'anthropic-skills:chrome-browser'))).toBe(BROWSER_HINT)
    expect(hintOf(cfg, plugin('x', 'x:s'))).toBe('Use y')
    expect(hintOf(cfg, plugin('z'))).toBe('')
    const reason = neverReason('Skill chrome-browser', BROWSER_HINT)
    expect(reason).toContain('is set to "never". Use the Playwright MCP instead')
    expect(reason.endsWith('instead. Do not work around it.')).toBe(true)
    expect(reason.includes('..')).toBe(false)
    expect(neverReason('Agent x', '')).toBe('Cockpit: Agent x is set to "never". Do not work around it.')
  })
})

const V2_FILE = {
  version: 2,
  settings: { toasts: true, openOnStart: true, ciEverySec: 60, queuedAlertMin: 5, issueLimit: 80, demo: false, issueSummaries: false },
  states: { 'skill:docs-lookup': 'an', 'mcp:context7': 'an', 'plugin:superpowers': 'aus', 'skill:anthropic-skills:chrome-browser': 'nie' },
  folders: { '/repo': { 'plugin:superpowers': 'an', 'mcp:x': 'nie' }, '/other': { 'plugin:a': 'aus' } },
  hints: { 'skill:anthropic-skills:chrome-browser': BROWSER_HINT },
  redirects: [{ match: 'curl.*example', sources: ['mcp:x'] }],
  startupMarkers: { superpowers: 'You have superpowers' },
}

describe('migration from format 2', () => {
  const parsed = parseConfig(JSON.stringify(V2_FILE), DEFAULT_CONFIG)

  test('an/aus/nie become on/off/never, in states and in every folder', () => {
    expect(parsed.error).toBeNull()
    expect(parsed.migratedFrom).toBe(2)
    expect(parsed.config.version).toBe(3)
    expect(parsed.config.states).toEqual({ 'skill:docs-lookup': 'on', 'mcp:context7': 'on', 'plugin:superpowers': 'off', 'skill:anthropic-skills:chrome-browser': 'never' })
    expect(parsed.config.folders).toEqual({ '/repo': { 'plugin:superpowers': 'on', 'mcp:x': 'never' }, '/other': { 'plugin:a': 'off' } })
  })

  test('defaultState becomes off, hints, detours, startup texts and settings stay', () => {
    expect(parsed.config.settings).toEqual({ ...V2_FILE.settings, summaryModel: 'haiku', defaultState: 'off', language: 'auto', notifyRunEnd: true })
    expect(parsed.config.hints).toEqual(V2_FILE.hints)
    expect(parsed.config.redirects).toEqual(V2_FILE.redirects)
    expect(parsed.config.startupMarkers).toEqual(V2_FILE.startupMarkers)
    expect(stateOf(parsed.config, ownerOf('mcp:unknown')).effective).toBe('off')
  })

  test('without a version field format 2 applies', () => {
    const { version: _, ...noVersion } = V2_FILE
    const r = parseConfig(JSON.stringify(noVersion), DEFAULT_CONFIG)
    expect(r.migratedFrom).toBe(2)
    expect(r.config.states['mcp:context7']).toBe('on')
  })

  test('without a version field, on/off/never is an error and nothing is migrated', () => {
    const r = parseConfig(JSON.stringify({ states: { 'skill:a': 'on', 'mcp:b': 'never' }, folders: { '/r': { 'plugin:c': 'off' } } }), DEFAULT_CONFIG)
    expect(r.error?.code).toBe('badValues')
    expect(r.migratedFrom).toBeUndefined()
    expect(r.config).toBe(DEFAULT_CONFIG)
  })
})

describe('reading cockpit.json', () => {
  test('round trip of format 3 without migration', () => {
    const again = parseConfig(JSON.stringify(DEFAULT_CONFIG), DEFAULT_CONFIG)
    expect(again.error).toBeNull()
    expect(again.migratedFrom).toBeUndefined()
    expect(again.config).toEqual(DEFAULT_CONFIG)
    const off = { ...DEFAULT_CONFIG, settings: { ...DEFAULT_CONFIG.settings, defaultState: 'off' as const } }
    expect(parseConfig(JSON.stringify(off), DEFAULT_CONFIG).config.settings.defaultState).toBe('off')
  })

  test('format 3 is strict: an unknown state is an error, not silently dropped', () => {
    const states = parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, states: { 'skill:a': 'on', 'skill:b': 'perhaps' } }), DEFAULT_CONFIG)
    expect(states.error).toEqual({ code: 'badValues', detail: 'skill:b: "perhaps"' })
    expect(states.config).toBe(DEFAULT_CONFIG)
    const old = parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, states: { 'skill:a': 'an' } }), DEFAULT_CONFIG)
    expect(old.error?.code).toBe('badValues')
    const folders = parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, folders: { '/r': { 'plugin:a': 'maybe' } } }), DEFAULT_CONFIG)
    expect(folders.error).toEqual({ code: 'badValues', detail: 'plugin:a: "maybe"' })
    const dflt = parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, settings: { ...DEFAULT_CONFIG.settings, defaultState: 'never' } }), DEFAULT_CONFIG)
    expect(dflt.error).toEqual({ code: 'badValues', detail: 'settings.defaultState: "never"' })
  })

  test('an unknown or invalid version is an error', () => {
    for (const version of [4, 99, '3', null, 2.5]) {
      const r = parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, version }), DEFAULT_CONFIG)
      expect(r.error?.code).toBe('badVersion')
      expect(r.config).toBe(DEFAULT_CONFIG)
    }
  })

  test('gaps in format 3 come from the default', () => {
    const part = parseConfig(JSON.stringify({ version: 3, states: { 'skill:a': 'on' } }), DEFAULT_CONFIG)
    expect(part.error).toBeNull()
    expect(part.config.states).toEqual({ 'skill:a': 'on' })
    expect(part.config.redirects).toEqual(DEFAULT_CONFIG.redirects)
    expect(part.config.settings).toEqual(DEFAULT_CONFIG.settings)
  })

  test('format 3 reports what it cannot read instead of dropping it', () => {
    const bad = (extra: Record<string, unknown>) => parseConfig(JSON.stringify({ version: 3, states: {}, ...extra }), DEFAULT_CONFIG).error?.code
    expect(bad({ states: { broken: 'on' } })).toBe('badValues')
    expect(bad({ folders: { relative: { 'plugin:a': 'on' } } })).toBe('badValues')
    expect(bad({ hints: { 'skill:a': 3 } })).toBe('badValues')
    expect(bad({ startupMarkers: [] })).toBe('badValues')
    expect(bad({ redirects: [{ match: 'x' }] })).toBe('badValues')
    expect(bad({ redirects: 'x' })).toBe('badValues')
    expect(bad({ settings: { runnerPool: { healthUrl: 'http://pool.lan/health' } } })).toBe('badValues')
    expect(bad({ settings: { runnerPool: { healthUrl: 'https://pool.example.org/h', token: { command: 'op' } } } })).toBe('badValues')
    expect(bad({ settings: { ciEverySec: 'fast' } })).toBe('badValues')
    expect(bad({})).toBeUndefined()
  })

  test('unknown fields and settings are kept for the write-back', () => {
    const r = parseConfig(JSON.stringify({ version: 3, states: {}, future: { a: 1 }, settings: { next: true } }), DEFAULT_CONFIG)
    expect(r.error).toBeNull()
    expect(r.config.unknown).toEqual({ top: { future: { a: 1 } }, settings: { next: true } })
    expect(parseConfig(JSON.stringify({ version: 3, states: {} }), DEFAULT_CONFIG).config.unknown).toBeUndefined()
  })

  test('polling never runs faster than every 30 s, counts are whole numbers', () => {
    const read = (settings: Record<string, unknown>) => parseConfig(JSON.stringify({ version: 3, states: {}, settings }), DEFAULT_CONFIG).config.settings
    expect(read({ ciEverySec: 1 }).ciEverySec).toBe(30)
    expect(read({ ciEverySec: 0 }).ciEverySec).toBe(0)
    expect(read({ ciEverySec: 90.4 }).ciEverySec).toBe(90)
    expect(read({ issueLimit: 1.5 }).issueLimit).toBe(2)
  })

  test('redirect patterns: long, nested-quantifier and invalid ones are rejected', () => {
    const rules = (match: string) => JSON.stringify({ version: 3, states: {}, redirects: [{ match, sources: ['mcp:a'] }] })
    expect(parseConfig(rules('\\bcurl\\b'), DEFAULT_CONFIG).error).toBeNull()
    expect(parseConfig(rules('(\\w+\\s?)+$'), DEFAULT_CONFIG).error?.code).toBe('badValues')
    expect(parseConfig(rules('('), DEFAULT_CONFIG).error?.code).toBe('badValues')
    expect(parseConfig(rules('a'.repeat(201)), DEFAULT_CONFIG).error?.code).toBe('badValues')
  })

  test('a long command is cut before matching', () => {
    const cfg = { ...DEFAULT_CONFIG, redirects: [{ match: 'curl$', sources: ['mcp:a'] }] }
    expect(findRedirect(cfg, `${'x'.repeat(2000)} curl`, ['mcp:a'])).toBe(null)
    expect(findRedirect(cfg, 'curl', ['mcp:a'])?.source).toBe('mcp:a')
  })

  test('a long whitespace run in MCP instructions stays fast', () => {
    const text = `# MCP Server Instructions\n\n## a${' '.repeat(200_000)}b\ntext\n`
    const start = Date.now()
    filterMcpInstructions(text, () => false, () => true)
    expect(Date.now() - start).toBeLessThan(500)
  })

  test('a broken file reports the error and returns the default', () => {
    const r = parseConfig('{broken', DEFAULT_CONFIG)
    expect(r.config).toBe(DEFAULT_CONFIG)
    expect(r.error?.code).toBe('badJson')
    expect(parseConfig('{"version":3}', DEFAULT_CONFIG).error).toEqual({ code: 'noStates' })
  })
})

describe('assignment', () => {
  test('built-in skills and agents are never hidden', () => {
    expect(skillOwner('simplify', { source: 'builtin' })).toBe(null)
    expect(skillOwner('loop', undefined)).toBe(null)
    expect(agentOwner('Explore', 'built-in', 'engine')).toBe(null)
  })

  test('plugin skills belong to their plugin, with the full name as child', () => {
    expect(skillOwner('superpowers:brainstorming', { source: 'plugin', plugin: 'superpowers' })).toEqual(plugin('superpowers', 'superpowers:brainstorming'))
    expect(skillOwner('brainstorming', { source: 'plugin', plugin: 'superpowers@x' })).toEqual(plugin('superpowers', 'superpowers:brainstorming'))
    expect(skillOwner('docs-lookup', { source: 'user' })).toEqual({ kind: 'skill', name: 'docs-lookup' })
    expect(mcpServerOf('mcp__claude_ai_Calendar__sleep')).toBe('claude_ai_Calendar')
  })

  test('a plugin MCP server belongs to the longest matching plugin', () => {
    const plugins = ['flowkit@flowkit', 'flowkit-lsp-tools@flowkit-cloud']
    expect(mcpOwner('plugin_flowkit-lsp-tools_yaml', plugins)).toEqual(plugin('flowkit-lsp-tools', undefined, 'plugin_flowkit-lsp-tools_yaml'))
    expect(mcpOwner('plugin_flowkit_x', plugins)).toEqual(plugin('flowkit', undefined, 'plugin_flowkit_x'))
    expect(mcpOwner('claude_ai_Calendar', plugins)).toEqual({ kind: 'mcp', server: 'claude_ai_Calendar' })
    expect(ownerOf('mcp:plugin_flowkit_x', plugins)).toEqual(plugin('flowkit', undefined, 'plugin_flowkit_x'))
    expect(ownerOf('skill:flowkit:plan')).toEqual(plugin('flowkit', 'flowkit:plan'))
  })

  test('groups: children move under their plugin, cockpit is missing', () => {
    const known = [
      'plugin:cockpit', 'plugin:superpowers', 'skill:superpowers:brainstorming', 'skill:docs-lookup', 'mcp:context7',
      'mcp:plugin_playwright_playwright', 'plugin:playwright', 'mcp:cockpit', 'agent:scout', 'skill:orphan:x', 'mcp:claude_ai_Calendar',
    ]
    const g = groupSources(known, ['superpowers@a', 'playwright@b'])
    expect(g.skills).toEqual(['skill:docs-lookup'])
    expect(g.mcps).toEqual(['mcp:claude_ai_Calendar', 'mcp:context7'])
    expect(g.agents).toEqual(['agent:scout'])
    expect(g.plugins).toEqual([
      { key: 'plugin:orphan', children: ['skill:orphan:x'] },
      { key: 'plugin:playwright', children: ['mcp:plugin_playwright_playwright'] },
      { key: 'plugin:superpowers', children: ['skill:superpowers:brainstorming'] },
    ])
  })

  test('repo plugins: project/local only, not in user scope', () => {
    const user = { enabledPlugins: { 'superpowers@a': true, 'x@a': false } }
    const project = { enabledPlugins: { 'superpowers@a': true, 'flowkit@b': true, 'x@a': true } }
    const local = { enabledPlugins: { 'local@c': true, 'off@c': false } }
    expect(repoPlugins(user, project, local)).toEqual(['flowkit', 'local', 'x'])
    expect(repoPlugins(undefined, null, {})).toEqual([])
  })
})

describe('filtering the skill listing and MCP instructions', () => {
  test('removes entries with their continuation lines', () => {
    const listing = [
      'The following skills are available:',
      '',
      '- docs-lookup: Look up docs',
      '- superpowers:brainstorming: Clarify ideas',
      '  with a second line',
      '- cloudflare:wrangler: Wrangler',
      '- simplify: Clean up',
    ].join('\n')
    const { text, hidden } = filterSkillListing(listing, name => !name.startsWith('superpowers:'))
    expect(hidden).toEqual(['superpowers:brainstorming'])
    expect(text.includes('with a second line')).toBe(false)
    expect(text.includes('- cloudflare:wrangler: Wrangler')).toBe(true)
  })

  test('unindented continuation lines and "- x:" in the text belong to the entry before', () => {
    const text = ['- a: Skill A', 'TRIGGER — use a', '- not-a-skill: line in the text', '', '- b: Skill B'].join('\n')
    const { text: out, hidden } = filterSkillListing(text, n => n !== 'a', n => n === 'a' || n === 'b')
    expect(hidden).toEqual(['a'])
    expect(out).toBe(['', '- b: Skill B'].join('\n'))
  })

  test('MCP instructions: hidden servers are gone, the note sits at the end of the section', () => {
    const text = ['# MCP Server Instructions', '', '## context7', 'Docs.', '', '## claude_ai_Calendar', 'Assistant.', '', '# Other', 'x'].join('\n')
    const r = filterMcpInstructions(text, n => n === 'context7', () => true, false, n => `(${n} gone)`)
    expect(r.hidden).toEqual(['claude_ai_Calendar'])
    expect(r.text).toBe(['# MCP Server Instructions', '', '## context7', 'Docs.', '(1 gone)', '', '# Other', 'x'].join('\n'))
  })
})

const withRedirects: CockpitConfig = {
  ...DEFAULT_CONFIG,
  redirects: [
    { match: String.raw`\bplaywright\s+(screenshot|open)\b`, sources: ['plugin:playwright', 'mcp:playwright-headless'] },
    { match: String.raw`\bnpx\s+(-y\s+)?docs-cli\b`, sources: ['mcp:context7'] },
  ],
}

describe('detours, requests and LSP', () => {
  test('a detour takes the first installed source that is not never', () => {
    const cfg = withRedirects
    const cmd = 'npx -y docs-cli docs react'
    expect(findRedirect(cfg, cmd, ['mcp:context7'])?.source).toBe('mcp:context7')
    expect(findRedirect(cfg, cmd, [])).toBe(null)
    expect(findRedirect(cfg, cmd, ['mcp:context7'], s => s === 'mcp:context7')).toBe(null)
    const pw = 'playwright screenshot x.png'
    expect(findRedirect(cfg, pw, ['plugin:playwright', 'mcp:playwright-headless'])?.source).toBe('plugin:playwright')
    expect(findRedirect(cfg, pw, ['plugin:playwright', 'mcp:playwright-headless'], s => s === 'plugin:playwright')?.source).toBe('mcp:playwright-headless')
    expect(findRedirect(cfg, 'ls -la', ['mcp:context7'])).toBe(null)
  })

  test('the detour hint names the tool prefix, only matches with a fitting pattern', () => {
    expect(redirectHint('mcp:drawio')).toContain('mcp__drawio__')
    expect(redirectHint('plugin:playwright')).toContain('mcp__plugin_playwright_')
    const known = ['mcp:playwright-headless', 'mcp:claude_ai_Calendar']
    expect(findRedirect(withRedirects, 'npx -y playwright ' + 'screenshot https://x.de a.png', known)?.source).toBe('mcp:playwright-headless')
    expect(findRedirect(withRedirects, 'npx playwright test', known)).toBeNull()
    expect(findRedirect(withRedirects, 'curl https://wttr.in/Berlin', known)).toBeNull()
  })

  test(';name and naming in the prompt: off sources only, never not', () => {
    const known = ['mcp:claude_ai_Calendar', 'plugin:humanizer-de', 'plugin:superpowers', 'plugin:cowork-plugin-management']
    const off = () => true
    expect(requestedSources(known, 'show ;calendar data', off)).toEqual(['mcp:claude_ai_Calendar'])
    expect(requestedSources(known, 'show +gar data', off)).toEqual([])
    expect(requestedSources(known, 'with ;human please', off)).toEqual(['plugin:humanizer-de'])
    expect(requestedSources(known, 'with :human please', off)).toEqual([])
    expect(requestedSources(known, 'first a; then human', off)).toEqual([])
    expect(requestedSources(known, 'at 12:30 example: human', off)).toEqual([])
    expect(requestedSources(known, 'please run the Humanizer over it', off)).toEqual(['plugin:humanizer-de'])
    expect(requestedSources(known, '/humanizer-de:humanizer-de', off)).toEqual(['plugin:humanizer-de'])
    expect(requestedSources(known, 'are only single plugins skills mcps loaded now?', off)).toEqual([])
    expect(requestedSources(known, 'use cowork for that', off)).toEqual(['plugin:cowork-plugin-management'])
    // on and never are not candidates
    expect(requestedSources(known, 'show ;calendar data', s => s !== 'mcp:claude_ai_Calendar')).toEqual([])
  })

  test('a named plugin does not take its children along individually, a child alone does', () => {
    const known = ['plugin:superpowers', 'skill:superpowers:brainstorming', 'skill:superpowers:writing-plans']
    expect(requestedSources(known, 'take ;superpowers', () => true, ['superpowers'])).toEqual(['plugin:superpowers'])
    expect(requestedSources(known, 'take ;brainstorm', () => true, ['superpowers'])).toEqual(['skill:superpowers:brainstorming'])
    expect(requestedSources(known, 'take superpowers', () => true, ['superpowers'])).toEqual(['plugin:superpowers'])
  })

  test('tab suggestions: off first, never is missing', () => {
    const known = ['mcp:claude_ai_Calendar', 'mcp:calendar-local', 'mcp:calendar-old']
    const state = (s: string): State => (s === 'mcp:calendar-local' ? 'on' : s === 'mcp:calendar-old' ? 'never' : 'off')
    const describe = (kind: SourceKind, s: State) => `${kind}/${s}`
    const rows = sourceSuggestions(known, ';cal', state, describe)
    expect(rows.map(r => r.text)).toEqual([';claude_ai_Calendar', ';calendar-local'])
    expect(rows[0]?.description).toBe('mcp/off')
    expect(rows[1]?.description).toBe('mcp/on')
  })

  test('LSP tool and diagnostics only with an LSP plugin that is on', () => {
    const plugins = ['pyright-lsp@claude-plugins-official', 'superpowers@claude-plugins-official']
    const only = (on: string[]) => (o: Owner): State => (o.kind === 'plugin' && on.includes(o.name) ? 'on' : 'off')
    expect(lspAllowed(plugins, only(['pyright-lsp']))).toBe(true)
    expect(lspAllowed(plugins, only([]))).toBe(false)
    // without a loaded LSP plugin there is nothing to hide
    expect(lspAllowed(['superpowers@claude-plugins-official'], only([]))).toBe(true)
  })
})

describe('collecting sources', () => {
  test('agent name from the frontmatter, else from the file name; .md only', () => {
    expect(agentNameOf('---\nname: scout\nmodel: haiku\n---\nText', 'x.md')).toBe('scout')
    expect(agentNameOf('---\nname: "code-review"\n---\n', 'y.md')).toBe('code-review')
    expect(agentNameOf('no frontmatter', 'implementation.md')).toBe('implementation')
    expect(agentNameOf('---\nname: a\n---', 'notes.txt')).toBeNull()
  })

  test('a failed part does not empty its kind, MCP servers and agents stay until the session ends', () => {
    const prev = ['agent:scout', 'mcp:context7', 'mcp:plugin_playwright_playwright', 'plugin:alt', 'skill:docs-lookup', 'skill:gone']
    // Everything read: plugins and skills come fresh, plugin servers hang off the plugin, standalone servers and agents stay
    expect(mergeKnown(prev, ['plugin:playwright', 'skill:docs-lookup'], [])).toEqual(['agent:scout', 'mcp:context7', 'plugin:playwright', 'skill:docs-lookup'])
    // Skills unreadable: the old skills stay
    expect(mergeKnown(prev, ['plugin:playwright'], ['skill'])).toEqual(['agent:scout', 'mcp:context7', 'plugin:playwright', 'skill:docs-lookup', 'skill:gone'])
    // After a reload fresh is still empty: nothing disappears
    expect(mergeKnown(prev, [], ['plugin', 'skill', 'mcp', 'agent'])).toEqual([...prev].sort())
  })
})

describe('folders', () => {
  const base = (states: Record<string, State>, folders: CockpitConfig['folders'] = {}): CockpitConfig => ({ ...cfgWith({}), states, folders })
  const sp: Owner = { kind: 'plugin', name: 'superpowers' }
  const brain: Owner = { kind: 'plugin', name: 'superpowers', skill: 'superpowers:brainstorming' }

  test('a folder entry replaces the global one of the same source, other folders do not count', () => {
    const cfg = base({ 'plugin:superpowers': 'off' }, { '/repo': { 'plugin:superpowers': 'on' }, '/elsewhere': { 'plugin:superpowers': 'never' } })
    expect(stateOf(cfg, sp, [], [], '/repo')).toEqual({ saved: 'on', effective: 'on', via: 'own', isFolder: true })
    expect(stateOf(cfg, sp, [], [], '/repo/')).toEqual({ saved: 'on', effective: 'on', via: 'own', isFolder: true })
    expect(stateOf(cfg, sp, [], [], '/nowhere')).toEqual({ saved: 'off', effective: 'off', via: 'own', isFolder: false })
    expect(stateOf(cfg, sp)).toEqual({ saved: 'off', effective: 'off', via: 'own', isFolder: false })
  })

  test('inheritance stays: plugin on here lifts the children, a global own "never" of the child stays', () => {
    const cfg = base({ 'plugin:superpowers': 'off' }, { '/repo': { 'plugin:superpowers': 'on' } })
    expect(stateOf(cfg, brain, [], [], '/repo')).toEqual({ saved: 'on', effective: 'on', via: 'plugin', isFolder: true })
    const never = base({ 'skill:superpowers:brainstorming': 'never' }, { '/repo': { 'plugin:superpowers': 'on' } })
    expect(stateOf(never, brain, [], [], '/repo').effective).toBe('never')
    // "never" here beats any session grant
    const here = base({}, { '/repo': { 'plugin:superpowers': 'never' } })
    expect(stateOf(here, sp, ['plugin:superpowers'], [], '/repo').effective).toBe('never')
  })

  test('setting and clearing; an empty folder drops out, the global state stays untouched', () => {
    const set = setFolderState(base({ 'plugin:x': 'on' }), '/repo/', 'plugin:superpowers', 'never')
    expect(set.folders).toEqual({ '/repo': { 'plugin:superpowers': 'never' } })
    expect(set.states).toEqual({ 'plugin:x': 'on' })
    expect(clearFolderState(set, '/repo', 'plugin:superpowers').folders).toEqual({})
  })

  test('parseConfig reads folders, Windows paths included; junk is an error', () => {
    const text = JSON.stringify({ ...DEFAULT_CONFIG, folders: { '/repo/': { 'plugin:a': 'on' }, 'C:\\repo\\': { 'plugin:a': 'off' }, '/empty': {} } })
    expect(parseConfig(text, DEFAULT_CONFIG).config.folders).toEqual({ '/repo': { 'plugin:a': 'on' }, 'C:\\repo': { 'plugin:a': 'off' } })
    const junk = JSON.stringify({ ...DEFAULT_CONFIG, folders: { relative: { 'plugin:a': 'on' } } })
    expect(parseConfig(junk, DEFAULT_CONFIG).error?.code).toBe('badValues')
    expect(folderKey('C:\\repo\\')).toBe('C:\\repo')
    const old = JSON.stringify({ ...DEFAULT_CONFIG, folders: undefined })
    expect(parseConfig(old, DEFAULT_CONFIG).config.folders).toEqual({})
  })
})

describe('UI text for errors and suggestions', () => {
  test('config errors and suggestion descriptions follow the locale', () => {
    try {
      S.locale = 'en'
      expect(configErrorText({ code: 'noStates' })).toBe('cockpit.json has no "states" field')
      expect(configErrorText({ code: 'badVersion', detail: '4' })).toBe('cockpit.json has an unknown version (4)')
      expect(describeSuggestion('mcp', 'off')).toBe('MCP server · load for this session')
      S.locale = 'de'
      expect(configErrorText({ code: 'noStates' })).toBe(t('cfgErr.noStates'))
      expect(configErrorText({ code: 'badJson', detail: 'x' })).toBe(t('cfgErr.badJson', { detail: 'x' }))
      expect(describeSuggestion('mcp', 'off')).toBe(t('src.sugOff', { kind: t('src.sugMcp') }))
      expect(describeSuggestion('skill', 'on')).toBe('Skill · schon an')
    } finally {
      S.locale = 'en'
    }
  })
})
