// Pure logic, no `$` and no i18n import (i18n -> state -> defaults -> here would be a cycle), so it stays testable.

// A source has one of these forms:
//   plugin:<name>           everything of a plugin (skills, MCP servers, agents)
//   skill:<name>            a user skill (~/.claude/skills)
//   skill:<plugin>:<skill>  a single plugin skill (child of the plugin)
//   mcp:<server>            an MCP server as it appears in the tool name (claude_ai_Calendar, context7)
//   mcp:plugin_<p>_<s>      an MCP server of a plugin (child of the plugin)
//   agent:<name>            a user subagent (~/.claude/agents)

// on: visible · off: hidden, loads on first call · never: never loads
export type State = 'on' | 'off' | 'never'

// Optional self-hosted runner pool (a service answering GET healthUrl and, optionally, GET vmsUrl).
// Both URLs are https. The token for vmsUrl is never stored: `command` runs an argv and takes its
// trimmed stdout; `env` names an environment variable, read with `printenv`, so POSIX only (on Windows
// use `command`). `owner` prefixes the short repo names the pool reports; without it the owner of the
// current repo (or of the signed-in user) is used. `label` is shown in Settings.
export type RunnerPool = {
  healthUrl: string
  vmsUrl?: string
  token?: { command: string[] } | { env: string }
  label?: string
  owner?: string
  // Limits of the pool, shown as maxima in the runner view; the vmsUrl answer wins over these
  maxPool?: number
  maxRunnersPerRepo?: number
}

export type CockpitSettings = {
  toasts: boolean
  openOnStart: boolean
  // 0 = off
  ciEverySec: number
  queuedAlertMin: number
  // Issues per page in the Issues tab; 'auto' fits the window
  issuesPerPage: 'auto' | 5 | 10 | 20
  // Sample data in CI and Issues, shown in the pane only
  demo: boolean
  issueSummaries: boolean
  summaryModel: 'haiku' | 'sonnet'
  // State of a source without an entry of its own
  defaultState: 'on' | 'off'
  // UI language; 'auto' follows Claude Code's language setting, then the environment
  language: 'auto' | 'en' | 'de'
  // Native notification (toast as fallback) when a run of the current branch ends
  notifyRunEnd: boolean
  runnerPool?: RunnerPool
}

export const DEFAULT_SETTINGS: CockpitSettings = {
  toasts: true,
  openOnStart: true,
  ciEverySec: 90,
  queuedAlertMin: 5,
  issuesPerPage: 'auto',
  demo: false,
  issueSummaries: false,
  summaryModel: 'haiku',
  defaultState: 'on',
  language: 'auto',
  notifyRunEnd: true,
}

export type Redirect = { match: string; sources: string[] }

export type CockpitConfig = {
  version: 3
  settings: CockpitSettings
  // Saved state per source. Without an entry a plugin child inherits from its plugin, else settings.defaultState
  // (exception: plugins enabled only in project/local scope are "on")
  states: Record<string, State>
  // Deviations per folder (git root, else session start folder): an entry replaces the global one of the same source
  folders: Record<string, Record<string, State>>
  // Better way per "never" source; goes into the denial text
  hints: Record<string, string>
  // Bash detours: a command matching the pattern is stopped and the first fitting source is loaded
  redirects: Redirect[]
  startupMarkers: Record<string, string>
  // Fields of the file this version does not know; written back unchanged
  unknown?: { top: Record<string, unknown>; settings: Record<string, unknown> }
}

export type SkillInfo = { source: string; plugin?: string }

export type Owner =
  // skill/server: the single plugin skill or MCP server (child of the plugin)
  | { kind: 'plugin'; name: string; skill?: string; server?: string }
  | { kind: 'skill'; name: string }
  | { kind: 'mcp'; server: string }
  | { kind: 'agent'; name: string }

export const norm = (s: string): string => s.replace(/[^A-Za-z0-9]/g, '_').toLowerCase()

// "superpowers@claude-plugins-official" -> "superpowers"
export const bareName = (key: string): string => key.split('@')[0] ?? key

// Comparable key: the kind stays, the name is normalized like `norm`
export function normKey(key: string): string {
  const i = key.indexOf(':')
  return i < 0 ? norm(key) : `${key.slice(0, i)}:${norm(key.slice(i + 1))}`
}

const hasKey = (list: readonly string[], key: string): boolean => {
  const n = normKey(key)
  return list.some(k => normKey(k) === n)
}

function explicit(states: Record<string, State>, key: string): State | undefined {
  const direct = states[key]
  if (direct) return direct
  const n = normKey(key)
  for (const [k, v] of Object.entries(states)) if (normKey(k) === n) return v
  return undefined
}

// plugin_<plugin>_<server> belongs to the plugin with the longest matching name,
// so "flowkit" does not take the servers of "flowkit-lsp-tools"
export function mcpOwner(server: string, plugins: readonly string[]): Owner {
  const s = norm(server)
  if (!s.startsWith('plugin_')) return { kind: 'mcp', server }
  const match = plugins
    .map(bareName)
    .filter(p => s.startsWith(`plugin_${norm(p)}_`))
    .sort((a, b) => b.length - a.length)[0]
  return match ? { kind: 'plugin', name: match, server } : { kind: 'mcp', server }
}

// mcp__claude_ai_Calendar__events -> claude_ai_Calendar; built-in tools -> null
export function mcpServerOf(tool: string): string | null {
  const m = /^mcp__(.+?)__/.exec(tool)
  return m ? (m[1] ?? null) : null
}

// null: built-in or unknown, never hidden
export function skillOwner(name: string, info: SkillInfo | undefined): Owner | null {
  if (info) {
    if (info.source === 'builtin' || info.source === 'mcp') return null
    if (info.source === 'plugin') {
      const plugin = info.plugin ?? (name.includes(':') ? name.split(':')[0] : undefined)
      if (!plugin) return null
      const bare = bareName(plugin)
      return { kind: 'plugin', name: bare, skill: name.includes(':') ? name : `${bare}:${name}` }
    }
    if (info.source === 'user') return { kind: 'skill', name }
    return null
  }
  // Without info only the unambiguous "plugin:skill" form is assigned
  if (name.includes(':')) return { kind: 'plugin', name: name.split(':')[0] ?? name, skill: name }
  return null
}

export function agentOwner(name: string, source: string, plugin: string): Owner | null {
  if (/built/i.test(source)) return null
  // Plugin agents are named "plugin:agent" or come with source "plugin"; anything else is a user agent
  if (source === 'plugin' || name.includes(':')) {
    if (plugin && plugin !== 'engine' && !/settings/i.test(plugin)) return { kind: 'plugin', name: bareName(plugin) }
    if (name.includes(':')) return { kind: 'plugin', name: name.split(':')[0] ?? name }
    return null
  }
  return { kind: 'agent', name }
}

// Own key of a source and the key of its parent plugin (plugin children only)
export function keysOf(owner: Owner): { own: string; parent: string | null } {
  switch (owner.kind) {
    case 'plugin':
      if (owner.skill) return { own: `skill:${owner.skill}`, parent: `plugin:${owner.name}` }
      if (owner.server) return { own: `mcp:${owner.server}`, parent: `plugin:${owner.name}` }
      return { own: `plugin:${owner.name}`, parent: null }
    case 'skill':
      return { own: `skill:${owner.name}`, parent: null }
    case 'mcp':
      return { own: `mcp:${owner.server}`, parent: null }
    case 'agent':
      return { own: `agent:${owner.name}`, parent: null }
  }
}

// What a call loads: a plugin skill only itself (skill:plugin:name), anything else the whole source
// (so a plugin MCP server loads its plugin)
export function loadSource(owner: Owner): string {
  if (owner.kind === 'plugin') return owner.skill ? `skill:${owner.skill}` : `plugin:${owner.name}`
  return keysOf(owner).own
}

// `plugins` is only needed to assign plugin MCP servers
export function ownerOf(source: string, plugins: readonly string[] = []): Owner {
  const i = source.indexOf(':')
  const kind = source.slice(0, i)
  const name = source.slice(i + 1)
  if (kind === 'mcp') return mcpOwner(name, plugins)
  if (kind === 'skill') return name.includes(':') ? { kind: 'plugin', name: name.split(':')[0] ?? name, skill: name } : { kind: 'skill', name }
  if (kind === 'agent') return { kind: 'agent', name }
  return { kind: 'plugin', name }
}

const isCockpit = (owner: Owner): boolean =>
  (owner.kind === 'plugin' && norm(owner.name) === 'cockpit') || (owner.kind === 'mcp' && norm(owner.server) === 'cockpit')

export type Via = 'own' | 'plugin' | 'default' | 'session'
// isFolder: the deciding entry is a deviation of this folder
export type Resolved = { saved: State; effective: State; via: Via; isFolder: boolean }

// Saved state (own entry, else parent plugin, else scope default) and effective state
// (a session grant lifts "off" to "on"; "never" is never lifted).
// scopeDefaults: plugins enabled only in project/local scope (without an entry they are "on").
// folder: session folder; its entries replace the global ones of the same source, inheritance is unchanged.
export function stateOf(
  cfg: CockpitConfig,
  owner: Owner,
  sessionGrants: readonly string[] = [],
  scopeDefaults: readonly string[] = [],
  folder = '',
): Resolved {
  if (isCockpit(owner)) return { saved: 'on', effective: 'on', via: 'default', isFolder: false }
  const { own, parent } = keysOf(owner)
  const here = folderStates(cfg, folder)
  const pick = (key: string) => {
    const local = explicit(here, key)
    return local ? { state: local, isFolder: true } : { state: explicit(cfg.states, key), isFolder: false }
  }
  const ownPick = pick(own)
  const parentPick = parent ? pick(parent) : { state: undefined, isFolder: false }
  const mine = ownPick.state
  const inherited = parentPick.state
  const isFolder = mine ? ownPick.isFolder : inherited ? parentPick.isFolder : false
  let saved: State
  let via: Via
  if (mine) {
    saved = mine
    via = 'own'
  } else if (inherited) {
    saved = inherited
    via = 'plugin'
  } else {
    const pluginName = (parent ?? own).startsWith('plugin:') ? (parent ?? own).slice(7) : ''
    saved = pluginName && scopeDefaults.some(p => norm(bareName(p)) === norm(pluginName)) ? 'on' : cfg.settings.defaultState
    via = 'default'
  }
  const isGranted = hasKey(sessionGrants, own) || (parent !== null && hasKey(sessionGrants, parent))
  if (saved === 'off' && isGranted) return { saved, effective: 'on', via: 'session', isFolder }
  return { saved, effective: saved, via, isFolder }
}

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/

// Key of a folder in cockpit.json: absolute path without trailing separator (POSIX or Windows)
export const folderKey = (path: string): string =>
  path.length > 1 && !/^[A-Za-z]:[\\/]+$/.test(path) ? path.replace(/[\\/]+$/, '') : path

export function folderStates(cfg: CockpitConfig, folder: string): Record<string, State> {
  return folder ? (cfg.folders[folderKey(folder)] ?? {}) : {}
}

// Own entry of a source in this folder (no inheritance)
export function folderEntry(cfg: CockpitConfig, folder: string, source: string): State | undefined {
  return explicit(folderStates(cfg, folder), source)
}

export function setFolderState(cfg: CockpitConfig, folder: string, source: string, state: State): CockpitConfig {
  const key = folderKey(folder)
  return { ...cfg, folders: { ...cfg.folders, [key]: { ...withoutKey(cfg.folders[key] ?? {}, source), [source]: state } } }
}

// A folder left empty is dropped entirely
export function clearFolderState(cfg: CockpitConfig, folder: string, source: string): CockpitConfig {
  const key = folderKey(folder)
  const rest = withoutKey(cfg.folders[key] ?? {}, source)
  const folders = { ...cfg.folders }
  if (Object.keys(rest).length > 0) folders[key] = rest
  else delete folders[key]
  return { ...cfg, folders }
}

// Hint for a "never" source: own entry, else the plugin's
export function hintOf(cfg: CockpitConfig, owner: Owner): string {
  const { own, parent } = keysOf(owner)
  const find = (key: string): string | undefined => {
    const n = normKey(key)
    return Object.entries(cfg.hints).find(([k]) => normKey(k) === n)?.[1]
  }
  return (find(own) ?? (parent ? find(parent) : undefined) ?? '').trim()
}

// Model-facing, so English regardless of the UI locale; the hint never ends in a double period
export function neverReason(what: string, hint: string): string {
  const h = hint.trim().replace(/[.\s]+$/, '')
  return `Cockpit: ${what} is set to "never".${h ? ` ${h}.` : ''} Do not work around it.`
}

// Filters the skill listing ("- name: description"; continuation lines belong to the entry before).
export function filterSkillListing(
  text: string,
  keep: (name: string) => boolean,
  // Is this really a skill name? Otherwise "- x: ..." is just a line in the text of the entry before
  isEntry: (name: string) => boolean = () => true,
): { text: string; hidden: string[] } {
  const lines = text.split('\n')
  const out: string[] = []
  const hidden: string[] = []
  let isDropping = false
  for (const line of lines) {
    const m = /^- (.+?): /.exec(line) ?? /^- (\S+):?$/.exec(line)
    if (m && isEntry(m[1] ?? '')) {
      const name = m[1] ?? ''
      isDropping = !keep(name)
      if (isDropping) {
        hidden.push(name)
        continue
      }
      out.push(line)
      continue
    }
    // Continuation lines belong to the entry before, indented or not; a blank line ends it
    if (isDropping && line.trim() !== '') continue
    isDropping = false
    out.push(line)
  }
  return { text: out.join('\n'), hidden }
}

export const MCP_HEADING = /^# MCP Server Instructions\s*$/m

// Removes the "## <server>" subsections of hidden servers from the "# MCP Server Instructions" section.
// `isServer` tells real server headings from "## ..." inside an instruction's text; `isRegion` is for attachments
// that consist of subsections only (no main heading). `keep` gets the server name of the heading.
export function filterMcpInstructions(
  text: string,
  keep: (server: string) => boolean,
  isServer: (name: string) => boolean,
  isRegion = false,
  // Closing line at the end of the section when something is missing
  note: (hidden: number) => string = () => '',
): { text: string; hidden: string[] } {
  const out: string[] = []
  const hidden: string[] = []
  let inRegion = isRegion
  let isDropping = false
  let regionEnd = -1
  const close = () => {
    if (inRegion && regionEnd < 0) regionEnd = out.length
    inRegion = false
    isDropping = false
  }
  for (const line of text.split('\n')) {
    if (/^# MCP Server Instructions\s*$/.test(line)) {
      inRegion = true
      isDropping = false
      out.push(line)
      continue
    }
    if (inRegion && /^# (?!#)/.test(line)) close()
    if (inRegion) {
      // No regex: instructions come from foreign servers and a long whitespace run would make one quadratic
      const name = line.startsWith('## ') ? line.slice(3).trim() : ''
      if (name !== '' && isServer(name)) {
        isDropping = !keep(name)
        if (isDropping) {
          hidden.push(name)
          continue
        }
      } else if (isDropping) continue
    }
    out.push(line)
  }
  if (inRegion && regionEnd < 0) regionEnd = out.length
  if (hidden.length === 0) return { text, hidden }
  const hint = note(hidden.length)
  if (hint) {
    // Before the trailing blank lines so the next heading keeps its spacing
    let at = regionEnd < 0 ? out.length : regionEnd
    while (at > 0 && (out[at - 1] ?? '').trim() === '') at--
    out.splice(at, 0, hint)
  }
  return { text: out.join('\n'), hidden }
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const SOURCE_RE = /^(plugin|skill|mcp|agent):\S+$/

const STATES: readonly State[] = ['on', 'off', 'never']
const V2_STATES = new Map<unknown, State>([['an', 'on'], ['aus', 'off'], ['nie', 'never']])

const isRecord = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object' && !Array.isArray(raw)

// Version 3 accepts only on/off/never, version 2 (or no version) only the German an/aus/nie; anything else lands in
// `bad` so a broken file never silently loses entries.
const asStates = (raw: unknown, bad: string[], isLegacy: boolean): Record<string, State> => {
  const out: Record<string, State> = {}
  if (!isRecord(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    if (!SOURCE_RE.test(k)) {
      if (!isLegacy) bad.push(`${k}: not a source`)
      continue
    }
    const state = isLegacy ? V2_STATES.get(v) : STATES.find(s => s === v)
    if (state) out[k] = state
    else bad.push(`${k}: ${JSON.stringify(v)}`)
  }
  return out
}

const asFolders = (raw: unknown, bad: string[], isLegacy: boolean): Record<string, Record<string, State>> => {
  const out: Record<string, Record<string, State>> = {}
  if (!isRecord(raw)) return out
  for (const [k, v] of Object.entries(raw)) {
    const states = asStates(v, bad, isLegacy)
    if (!ABSOLUTE_PATH.test(k)) {
      if (!isLegacy) bad.push(`folders.${k}: not an absolute path`)
      continue
    }
    if (Object.keys(states).length > 0) out[folderKey(k)] = states
  }
  return out
}

const asStrings = (raw: unknown, name: string, bad: string[], isLegacy: boolean): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!isRecord(raw)) {
    if (raw !== undefined && !isLegacy) bad.push(`${name}: not an object`)
    return out
  }
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v
    else if (!isLegacy) bad.push(`${name}.${k}: ${JSON.stringify(v)}`)
  }
  return out
}

const REDIRECT_PATTERN_MAX = 200
const REDIRECT_COMMAND_MAX = 2000
// Quantified group inside a quantified group: the classic catastrophic-backtracking shape
const NESTED_QUANTIFIER = /\([^)]*[+*][^)]*\)[+*{]/

// null when the pattern may be used; otherwise why not
export function redirectPatternError(match: string): string | null {
  if (match.length > REDIRECT_PATTERN_MAX) return 'too long'
  if (NESTED_QUANTIFIER.test(match)) return 'nested quantifiers'
  try {
    new RegExp(match, 'i')
  } catch {
    return 'invalid'
  }
  return null
}

const asRedirects = (raw: unknown, fallback: Redirect[], bad: string[], isLegacy: boolean): Redirect[] => {
  if (raw === undefined) return fallback
  if (!Array.isArray(raw)) {
    if (!isLegacy) bad.push('redirects: not a list')
    return fallback
  }
  const out: Redirect[] = []
  for (const r of raw as unknown[]) {
    const isShape = isRecord(r) && typeof r['match'] === 'string' && Array.isArray(r['sources']) && r['sources'].every(x => typeof x === 'string')
    const why = isShape ? redirectPatternError(r['match'] as string) : 'invalid rule'
    if (isShape && !why) out.push(r as Redirect)
    else if (!isLegacy) bad.push(`redirects: ${why} ${JSON.stringify(isRecord(r) ? r['match'] : r)?.slice(0, 40) ?? ''}`.trim())
  }
  return out
}

const HTTPS_HOST = /^https:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]\S*)?$/i

// Host of an https URL without userinfo; null for anything else
export const httpsHost = (url: string): string | null => HTTPS_HOST.exec(url)?.[1]?.toLowerCase() ?? null

const NAME = /^[\w.-]+$/
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 1000

// undefined for an invalid pool; `tokenCommand` and `tokenEnv` are accepted next to the nested `token`
export function cleanPool(raw: unknown): RunnerPool | undefined {
  if (!isRecord(raw)) return undefined
  const { healthUrl, vmsUrl, token, label, owner, maxPool, maxRunnersPerRepo } = raw
  if (typeof healthUrl !== 'string' || !httpsHost(healthUrl)) return undefined
  if (vmsUrl !== undefined && !(typeof vmsUrl === 'string' && httpsHost(vmsUrl))) return undefined
  const pool: RunnerPool = { healthUrl }
  if (typeof vmsUrl === 'string') pool.vmsUrl = vmsUrl
  const spec = isRecord(token) ? token : { command: raw['tokenCommand'], env: raw['tokenEnv'] }
  const { command, env } = spec
  if (command !== undefined || env !== undefined || token !== undefined) {
    if (Array.isArray(command) && command.length > 0 && command.every(a => typeof a === 'string')) pool.token = { command: command as string[] }
    else if (typeof env === 'string' && ENV_NAME.test(env)) pool.token = { env }
    else return undefined
  }
  if (typeof label === 'string' && label.trim() !== '') pool.label = label.trim().slice(0, 40)
  if (owner !== undefined) {
    if (typeof owner !== 'string' || !NAME.test(owner)) return undefined
    pool.owner = owner
  }
  if (maxPool !== undefined) {
    if (!isCount(maxPool)) return undefined
    pool.maxPool = maxPool
  }
  if (maxRunnersPerRepo !== undefined) {
    if (!isCount(maxRunnersPerRepo)) return undefined
    pool.maxRunnersPerRepo = maxRunnersPerRepo
  }
  return pool
}

// issueLimit (before issuesPerPage) is dropped quietly instead of being kept as an unknown key
const SETTING_KEYS = new Set<string>([...Object.keys(DEFAULT_SETTINGS), 'runnerPool', 'issueLimit'])

// Known fields of the right type only; the rest falls back to the default. In version 3 a wrong type lands in `bad`.
function cleanSettings(raw: unknown, bad: string[], isLegacy: boolean): CockpitSettings {
  const r = isRecord(raw) ? raw : {}
  const wrong = (k: string) => {
    if (!isLegacy && r[k] !== undefined) bad.push(`settings.${k}: ${JSON.stringify(r[k])}`)
  }
  const bool = (k: keyof CockpitSettings): boolean => {
    if (typeof r[k] === 'boolean') return r[k]
    wrong(k)
    return DEFAULT_SETTINGS[k] as boolean
  }
  const num = (k: keyof CockpitSettings): number => {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
    wrong(k)
    return DEFAULT_SETTINGS[k] as number
  }
  const runnerPool = cleanPool(r['runnerPool'])
  if (!runnerPool) wrong('runnerPool')
  const everySec = num('ciEverySec')
  const perPage = r['issuesPerPage']
  const isPerPage = perPage === 'auto' || perPage === 5 || perPage === 10 || perPage === 20
  if (!isPerPage) wrong('issuesPerPage')
  return {
    toasts: bool('toasts'),
    openOnStart: bool('openOnStart'),
    // Polling faster than every 30 s would hit the GitHub rate limit from every session
    ciEverySec: everySec === 0 ? 0 : Math.max(30, Math.round(everySec)),
    queuedAlertMin: Math.round(num('queuedAlertMin')),
    issuesPerPage: isPerPage ? perPage : DEFAULT_SETTINGS.issuesPerPage,
    demo: bool('demo'),
    issueSummaries: bool('issueSummaries'),
    summaryModel: r['summaryModel'] === 'sonnet' ? 'sonnet' : DEFAULT_SETTINGS.summaryModel,
    defaultState: r['defaultState'] === 'off' ? 'off' : DEFAULT_SETTINGS.defaultState,
    language: r['language'] === 'en' || r['language'] === 'de' ? r['language'] : DEFAULT_SETTINGS.language,
    notifyRunEnd: bool('notifyRunEnd'),
    ...(runnerPool ? { runnerPool } : {}),
  }
}

const KNOWN_TOP = new Set(['version', 'settings', 'states', 'folders', 'hints', 'redirects', 'startupMarkers'])

const unknownOf = (raw: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k)))

// Shown to the person, so the text is rendered with t() by the caller (configErrorText)
export type ConfigError =
  | { code: 'noStates' }
  | { code: 'badVersion' | 'badValues' | 'badJson'; detail: string }

export type ParsedConfig = {
  config: CockpitConfig
  error: ConfigError | null
  // Format of a file that was lifted to version 3 and has to be rewritten
  migratedFrom?: 2
}

// Checks a cockpit.json and fills gaps from the default.
// Version 3 is read strictly; version 2 (or no version) is lifted to 3, its sources without an entry were "off".
export function parseConfig(text: string, fallback: CockpitConfig): ParsedConfig {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (!isRecord(raw) || !isRecord(raw['states'])) {
      return { config: fallback, error: { code: 'noStates' } }
    }
    const version = raw['version']
    const isLegacy = version === undefined || version === 2
    if (!isLegacy && version !== 3) {
      return { config: fallback, error: { code: 'badVersion', detail: JSON.stringify(version) ?? 'undefined' } }
    }
    const bad: string[] = []
    const settings = cleanSettings(raw['settings'], bad, isLegacy)
    const rawDefault = isRecord(raw['settings']) ? raw['settings']['defaultState'] : undefined
    if (!isLegacy && rawDefault !== undefined && rawDefault !== 'on' && rawDefault !== 'off') bad.push(`settings.defaultState: ${JSON.stringify(rawDefault)}`)
    const config: CockpitConfig = {
      version: 3,
      settings: isLegacy ? { ...settings, defaultState: 'off' } : settings,
      states: asStates(raw['states'], bad, isLegacy),
      folders: asFolders(raw['folders'], bad, isLegacy),
      hints: asStrings(raw['hints'], 'hints', bad, isLegacy),
      redirects: asRedirects(raw['redirects'], fallback.redirects, bad, isLegacy),
      startupMarkers: raw['startupMarkers'] ? asStrings(raw['startupMarkers'], 'startupMarkers', bad, isLegacy) : fallback.startupMarkers,
    }
    const top = unknownOf(raw, KNOWN_TOP)
    const extraSettings = isRecord(raw['settings']) ? unknownOf(raw['settings'], SETTING_KEYS) : {}
    if (Object.keys(top).length > 0 || Object.keys(extraSettings).length > 0) config.unknown = { top, settings: extraSettings }
    if (bad.length > 0) return { config: fallback, error: { code: 'badValues', detail: bad.slice(0, 3).join(', ') } }
    return isLegacy ? { config, error: null, migratedFrom: 2 } : { config, error: null }
  } catch (err) {
    return { config: fallback, error: { code: 'badJson', detail: String(err) } }
  }
}

// An existing entry spelled differently is replaced
export function setState(cfg: CockpitConfig, source: string, state: State): CockpitConfig {
  return { ...cfg, states: { ...withoutKey(cfg.states, source), [source]: state } }
}

// Without its own state the source inherits from its plugin again
export function clearState(cfg: CockpitConfig, source: string): CockpitConfig {
  return { ...cfg, states: withoutKey(cfg.states, source) }
}

function withoutKey(states: Record<string, State>, source: string): Record<string, State> {
  const n = normKey(source)
  return Object.fromEntries(Object.entries(states).filter(([k]) => normKey(k) !== n))
}

export function setMarker(cfg: CockpitConfig, plugin: string, text: string | null): CockpitConfig {
  const startupMarkers = { ...cfg.startupMarkers }
  if (text === null || text.trim() === '') delete startupMarkers[plugin]
  else startupMarkers[plugin] = text.trim()
  return { ...cfg, startupMarkers }
}

// Plugins enabled only in project/local scope (not user scope): without an entry they count as "on"
export function repoPlugins(user: unknown, project: unknown, local: unknown): string[] {
  const on = (s: unknown): string[] => {
    const map = (s && typeof s === 'object' ? (s as Record<string, unknown>)['enabledPlugins'] : undefined) as Record<string, unknown> | undefined
    return Object.entries(map ?? {}).filter(([, v]) => v === true).map(([k]) => bareName(k))
  }
  const global = new Set(on(user))
  return [...new Set([...on(project), ...on(local)])].filter(p => !global.has(p) && norm(p) !== 'cockpit').sort()
}

// Name of a user agent from its .md file: "name:" in the frontmatter, else the file name
export function agentNameOf(text: string, file: string): string | null {
  if (!file.endsWith('.md')) return null
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ''
  const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(front)?.[1]?.trim()
  return name || file.slice(0, -3) || null
}

export type SourceKind = 'plugin' | 'skill' | 'mcp' | 'agent'
const kindOf = (src: string): string => src.slice(0, src.indexOf(':'))

// New source list from a scan: what was found, plus from the old list
// - everything of a kind whose part of the scan failed (an error does not empty the list),
// - standalone MCP servers and agents: they report late (connection, offer) and stay until the session ends
export function mergeKnown(prev: readonly string[], fresh: Iterable<string>, failed: readonly SourceKind[]): string[] {
  const out = new Set(fresh)
  for (const src of prev) {
    const kind = kindOf(src)
    const isSticky = (kind === 'mcp' && !norm(src.slice(4)).startsWith('plugin_')) || kind === 'agent'
    if (isSticky || (failed as readonly string[]).includes(kind)) out.add(src)
  }
  return [...out].sort()
}

export type SourceGroups = {
  skills: string[]
  plugins: Array<{ key: string; children: string[] }>
  mcps: string[]
  agents: string[]
}

// Known sources by kind: plugin skills and plugin MCP servers move under their plugin
export function groupSources(known: readonly string[], plugins: readonly string[]): SourceGroups {
  const skills: string[] = []
  const mcps: string[] = []
  const agents: string[] = []
  const tree = new Map<string, { key: string; children: string[] }>()
  const plugin = (name: string) => {
    const key = `plugin:${name}`
    const n = normKey(key)
    if (!tree.has(n)) tree.set(n, { key, children: [] })
    return tree.get(n)
  }
  for (const src of known) {
    const owner = ownerOf(src, plugins)
    if (isCockpit(owner)) continue
    if (owner.kind === 'plugin') {
      const entry = plugin(owner.name)
      if (src.startsWith('plugin:')) continue
      entry?.children.push(src)
    } else if (owner.kind === 'skill') skills.push(src)
    else if (owner.kind === 'mcp') mcps.push(src)
    else agents.push(src)
  }
  const sort = (a: string, b: string) => a.localeCompare(b)
  return {
    skills: skills.sort(sort),
    plugins: [...tree.values()].map(p => ({ ...p, children: [...new Set(p.children)].sort(sort) })).sort((a, b) => sort(a.key, b.key)),
    mcps: mcps.sort(sort),
    agents: agents.sort(sort),
  }
}

// The LSP tool and diagnostics belong to the LSP plugins

// Plugins that bring a language server are recognized by name (pyright-lsp, flowkit-lsp-tools)
export const isLspPlugin = (key: string): boolean => /(^|[-_])lsp([-_@]|$)/i.test(bareName(key))

// The LSP plugin that tool and diagnostics follow: on before off before never; null if none is loaded
export function lspOwner(plugins: readonly string[], stateFor: (owner: Owner) => State): { owner: Owner; state: State } | null {
  const rows = plugins
    .filter(isLspPlugin)
    .map(p => ({ owner: { kind: 'plugin', name: bareName(p) } as Owner }))
    .map(r => ({ ...r, state: stateFor(r.owner) }))
  return rows.find(r => r.state === 'on') ?? rows.find(r => r.state === 'off') ?? rows[0] ?? null
}

// The LSP tool and diagnostics stay if a loaded LSP plugin is on (or none is loaded)
export function lspAllowed(plugins: readonly string[], stateFor: (owner: Owner) => State): boolean {
  const lsp = lspOwner(plugins, stateFor)
  return lsp === null || lsp.state === 'on'
}

// Each rule is compiled once; a rule that parseConfig would reject never matches
const compiledRules = new WeakMap<Redirect, RegExp | null>()
function compiled(rule: Redirect): RegExp | null {
  let re = compiledRules.get(rule)
  if (re === undefined) {
    re = redirectPatternError(rule.match) === null ? new RegExp(rule.match, 'i') : null
    compiledRules.set(rule, re)
  }
  return re
}

// First rule whose pattern matches and that has an installed source which is not "never"
export function findRedirect(
  cfg: CockpitConfig,
  command: string,
  known: readonly string[],
  isNever: (source: string) => boolean = () => false,
): { rule: Redirect; source: string } | null {
  const head = command.slice(0, REDIRECT_COMMAND_MAX)
  for (const rule of cfg.redirects) {
    const re = compiled(rule)
    if (!re?.test(head)) continue
    const source = rule.sources.find(src => known.includes(src) && !isNever(src))
    if (source) return { rule, source }
  }
  return null
}

// How Claude addresses the source; model-facing, so English
export function redirectHint(source: string): string {
  const name = source.slice(source.indexOf(':') + 1)
  if (source.startsWith('mcp:')) return `the tools mcp__${name}__* (load the schema via ToolSearch)`
  if (source.startsWith('plugin:')) return `the MCP tools of the plugin ${name} (mcp__plugin_${name}_*, load the schema via ToolSearch)`
  if (source.startsWith('skill:')) return `the skill ${name} (Skill tool)`
  return `the agent ${name} (subagent_type)`
}

// Generic name parts that occur in prompts all the time and mean nothing specific
const COMMON_WORDS = new Set([
  'plugin', 'plugins', 'server', 'servers', 'skill', 'skills', 'tools', 'agent', 'agents', 'management',
  'manager', 'official', 'github', 'review', 'design', 'claude', 'search', 'browser', 'claude_ai',
])

// What identifies a source in a prompt: its name and distinctive parts of it ("humanizer" from "humanizer-de")
export function sourceWords(source: string): string[] {
  const name = source.slice(source.indexOf(':') + 1).toLowerCase()
  const parts = name.split(/[-_:.]/).filter(w => w.length >= 6 && !COMMON_WORDS.has(w))
  return [...new Set([name, ...parts])]
}

// Explicit: ";github" matches every source whose name or name part starts that way (3+ characters);
// the semicolon must start a word and a letter must follow, "a; b" does not count
export function explicitTokens(text: string): string[] {
  return [...text.toLowerCase().matchAll(/(?:^|\s);([\p{L}][\p{L}\p{N}_-]{2,})(?=$|[\s,.;:!?)])/gu)].map(m => m[1] ?? '').filter(Boolean)
}

function matchesToken(source: string, token: string): boolean {
  const name = source.slice(source.indexOf(':') + 1).toLowerCase()
  return name.startsWith(token) || name.split(/[-_:.]/).some(p => p.startsWith(token))
}

// Plugin children (skill or MCP server of a plugin) are not named in running text
const isChild = (source: string, plugins: readonly string[]): boolean => keysOf(ownerOf(source, plugins)).parent !== null

// Sources the prompt names (running text or ";name") that are currently "off";
// a named plugin takes its named children along
export function requestedSources(known: readonly string[], text: string, isOff: (source: string) => boolean, plugins: readonly string[] = []): string[] {
  const lower = text.toLowerCase()
  const tokens = explicitTokens(text)
  const hits = known.filter(src => {
    if (!isOff(src)) return false
    if (tokens.some(tok => matchesToken(src, tok))) return true
    if (isChild(src, plugins)) return false
    // Whole word: "plugin" does not match "plugins", "humanizer" matches "Humanizer,"
    return sourceWords(src).some(w => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(lower))
  })
  return hits.filter(src => {
    const parent = keysOf(ownerOf(src, plugins)).parent
    return parent === null || !hasKey(hits, parent)
  })
}

export type Suggestion = { text: string; label: string; description: string }

// Tab completion for ";name": matching sources, "off" first; "never" stays out.
// The description is UI text, so the caller renders it (this module has no i18n).
export function sourceSuggestions(
  known: readonly string[],
  token: string,
  stateFor: (source: string) => State,
  describe: (kind: SourceKind, state: State) => string,
): Suggestion[] {
  const lead = token[0] ?? ';'
  const q = token.slice(1).toLowerCase()
  return known
    .filter(src => q === '' || matchesToken(src, q))
    .map(src => ({ src, state: stateFor(src) }))
    .filter(r => r.state !== 'never')
    .sort((a, b) => Number(b.state === 'off') - Number(a.state === 'off') || a.src.localeCompare(b.src))
    .slice(0, 12)
    .map(({ src, state }) => {
      const name = src.slice(src.indexOf(':') + 1)
      return { text: `${lead}${name}`, label: `${lead}${name}`, description: describe(kindOf(src) as SourceKind, state) }
    })
}
