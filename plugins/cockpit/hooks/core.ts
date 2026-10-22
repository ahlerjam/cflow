import { atom, read, update } from 'claude-code'

import type { GhProblem } from '../types'
import type { CockpitConfig, CockpitSettings, Owner, ParsedConfig, RunnerPool, SkillInfo, State } from './sources'
import { REPO_NAME, ciShort, isRateLimit } from './ci'
import { DEFAULT_CONFIG } from './defaults'
import { configErrorText, resolveLocale, t } from './i18n'
import type { Key } from './i18n'
import { agentNameOf, bareName, clearFolderState, clearState, folderKey, groupSources, httpsHost, keysOf, mcpServerOf, mergeKnown, normKey, ownerOf, parseConfig, repoPlugins, setFolderState, setState, skillOwner, stateOf } from './sources'
import type { SourceKind } from './sources'
import { BACKOFF_MAX_MS, GH_AUTH_RETRY_MS, GH_PATHS, OWNER_CACHE_MS, S } from './state'
import type { Eng } from './state'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const cfgVerA = atom({ plugin: 'cockpit', key: 'configVersion' } as const, 0)
const ciA = atom({ plugin: 'cockpit', key: 'ci' } as const, null)
const confirmA = atom({ plugin: 'cockpit', key: 'confirm' } as const, '')
const noticeA = atom({ plugin: 'cockpit', key: 'notice' } as const, '')
// Survive a reload (which fires session.start again), start empty with every session
const knownA = atom({ plugin: 'cockpit', key: 'known' } as const, [])
const grantsA = atom({ plugin: 'cockpit', key: 'grants' } as const, [])
const usesA = atom({ plugin: 'cockpit', key: 'uses' } as const, {})

const srcName = (source: string): string => source.slice(source.indexOf(':') + 1)

export const resolve = (owner: Owner) => stateOf(S.cfg, owner, S.sessionGrants, S.scopeOnly, S.folder)
// Global state only, without folder and session: what the buttons of the Global view show
export const resolveGlobal = (owner: Owner) => stateOf(S.cfg, owner, [], S.scopeOnly)
export const stateFor = (owner: Owner): State => resolve(owner).effective
export const stateForKey = (source: string): State => stateFor(ownerOf(source, S.knownPlugins))

export function toast($: Eng, text: string): void {
  if (S.cfg.settings.toasts) $.ui.toast(text)
}

export async function note($: Eng, text: string): Promise<void> {
  await update($, noticeA, () => text)
}

// Through a temp file and mv so a session reading at the same time never sees half a file.
// Windows has no mv and $.fs cannot delete, so a temp file would be left behind there: write directly.
async function writeConfig($: Eng, config: CockpitConfig): Promise<void> {
  const { unknown, ...known } = config
  const body = JSON.stringify({ ...unknown?.top, ...known, settings: { ...unknown?.settings, ...known.settings } }, null, 2) + '\n'
  if ((await hostOs($)) === 'windows') {
    await $.fs.write(S.cfgPath, body)
    return
  }
  const tmp = `${S.cfgPath}.${await $.clock.now()}.tmp`
  try {
    await $.fs.write(tmp, body)
    const moved = await $.process.run(['mv', '-f', tmp, S.cfgPath], { timeoutMs: 5000 })
    if (moved.exitCode === 0) return
  } catch {
    // direct write below
  }
  await $.fs.write(S.cfgPath, body)
}

// Another session may be writing the file at this moment: a parse error gets one more read before it counts
async function readConfig($: Eng, fallback: CockpitConfig): Promise<{ text: string; parsed: ParsedConfig }> {
  let text = await $.fs.read(S.cfgPath)
  let parsed = parseConfig(text, fallback)
  if (parsed.error?.code === 'badJson') {
    await $.clock.sleep(150)
    text = await $.fs.read(S.cfgPath)
    parsed = parseConfig(text, fallback)
  }
  return { text, parsed }
}

// Claude Code's config folder: CLAUDE_CONFIG_DIR wins, so a throwaway config never touches the real cockpit.json
export async function configDir($: Eng): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  return custom || `${(await $.env.get('HOME')) ?? ''}/.claude`
}

// A format 2 file is lifted to 3 and rewritten (the original once as cockpit.json.bak-v2), also in
// non-interactive sessions. If the file is missing, only an interactive session writes the starter config.
// A broken file is never overwritten until it is repaired and reloaded.
export async function loadConfig($: Eng): Promise<void> {
  const dir = await configDir($)
  S.cfgPath = `${dir}/cockpit/cockpit.json`
  S.isCfgBroken = false
  S.poolToken = undefined
  S.poolTokenFailedAt = 0
  const fail = async (text: string, error: string) => {
    S.isCfgBroken = true
    await note($, text)
    toast($, t('toast.configError', { error }))
  }
  try {
    if (await $.fs.exists(S.cfgPath)) {
      const { text, parsed } = await readConfig($, DEFAULT_CONFIG)
      S.cfg = parsed.config
      await applyLocale($)
      if (parsed.error) {
        const error = configErrorText(parsed.error)
        await fail(t('cfg.broken', { error }), error)
      } else if (parsed.migratedFrom === 2) {
        const backup = `${S.cfgPath}.bak-v2`
        if (!(await $.fs.exists(backup))) await $.fs.write(backup, text)
        await writeConfig($, S.cfg)
      }
    } else {
      S.cfg = DEFAULT_CONFIG
      await applyLocale($)
      if (S.isInteractive) await writeConfig($, S.cfg)
    }
  } catch (err) {
    S.cfg = DEFAULT_CONFIG
    await applyLocale($)
    const error = String(err).slice(0, 120)
    await fail(t('cfg.unreadable', { error }), error)
  }
  await update($, cfgVerA, v => v + 1)
}

export async function registerCommand($: Eng): Promise<void> {
  S.commandLocale = S.locale
  await $.command.register({ name: 'cockpit', description: t('cmd.description'), argumentHint: '[sources|actions|issues|settings|help]' })
}

// Follows settings.language; the command description is the one piece of UI the engine holds, so it is registered again
export async function applyLocale($: Eng): Promise<void> {
  const locale = await resolveLocale($)
  if (locale === S.locale) return
  S.locale = locale
  if (S.commandLocale !== '' && S.commandLocale !== locale) await registerCommand($)
}

export async function saveConfig($: Eng, updated: CockpitConfig): Promise<void> {
  // Write first, then adopt: if the write fails, the pane shows nothing that is not on disk
  await writeConfig($, updated)
  S.cfg = updated
  await applyLocale($)
  await update($, cfgVerA, v => v + 1)
  invalidateGating($)
}

// Rebuilt every time so an uninstalled skill drops out. If command.list throws, the old list stays.
export async function refreshSkills($: Eng): Promise<void> {
  const skills = new Map<string, SkillInfo>()
  for (const c of await $.command.list()) {
    skills.set(c.name, { source: c.source, ...(c.plugin ? { plugin: c.plugin } : {}) })
  }
  S.skills = skills
}

// Session folder is the git root, else the start folder; its deviations live in cockpit.json under "folders"
export async function readFolder($: Eng, cwd: string): Promise<void> {
  const repo = await $.session.repo().catch(() => null)
  S.folder = folderKey(repo?.root || cwd)
  const home = (await $.env.get('HOME')) ?? ''
  S.folderLabel = home && S.folder.startsWith(home) ? `~${S.folder.slice(home.length)}` : S.folder
}

// Plugins of the session and those enabled only in project/local scope; the gating assigns plugin servers by them
export async function readPlugins($: Eng): Promise<void> {
  const merged = await $.settings.read()
  const enabled = (merged['enabledPlugins'] ?? {}) as Record<string, unknown>
  S.knownPlugins = Object.keys(enabled).filter(k => enabled[k] === true).sort()
  const scope = async (source: 'user' | 'project' | 'local') => {
    try {
      return await $.settings.read({ source })
    } catch {
      return {}
    }
  }
  S.scopeOnly = repoPlugins(await scope('user'), await scope('project'), await scope('local'))
}

// Own agents from ~/.claude/agents and <repo>/.claude/agents: known before the engine offers them
async function agentFiles($: Eng): Promise<string[]> {
  const root = await $.session.root().catch(() => '')
  const dirs = [...new Set([`${await configDir($)}/agents`, ...(root ? [`${root}/.claude/agents`] : [])])]
  const names: string[] = []
  for (const dir of dirs) {
    // A missing folder is not an error
    const entries = await $.fs.list(dir).catch(() => [])
    for (const f of entries) {
      if (f.kind !== 'file' || !f.name.endsWith('.md')) continue
      const name = agentNameOf(await $.fs.read(`${dir}/${f.name}`).catch(() => ''), f.name)
      if (name) names.push(name)
    }
  }
  return names
}

// All sources of this session: what the pane offers to switch and what ";name" and detours target.
// Runs at start, twice delayed after start, on every turn (throttled) and on a button press; calls
// during a run attach to it and trigger exactly one more.
export function discover($: Eng): Promise<void> {
  if (S.discovering) {
    S.isDiscoverDirty = true
    return S.discovering
  }
  const run = (async () => {
    do {
      S.isDiscoverDirty = false
      await discoverNow($)
    } while (S.isDiscoverDirty)
  })().finally(() => {
    S.discovering = null
  })
  S.discovering = run
  return run
}

async function discoverNow($: Eng): Promise<void> {
  S.lastDiscoverAt = await $.clock.now()
  const found = new Set<string>()
  const failed: SourceKind[] = []
  const errors: string[] = []
  // Each part on its own: if one fails, the sources of its kind from the last run stay
  const step = async (kind: SourceKind, label: string, run: () => Promise<void>) => {
    try {
      await run()
    } catch (err) {
      failed.push(kind)
      errors.push(`${label}: ${String(err).slice(0, 80)}`)
    }
  }
  const gateBefore = `${S.knownPlugins.join(',')}|${S.scopeOnly.join(',')}`
  await step('plugin', t('disc.plugins'), async () => {
    await readPlugins($)
    // Cockpit itself is not a source: it must not hide itself
    for (const key of S.knownPlugins) if (bareName(key) !== 'cockpit') found.add(`plugin:${bareName(key)}`)
  })
  await step('skill', t('disc.skills'), async () => {
    await refreshSkills($)
    for (const [name, info] of S.skills) {
      const owner = skillOwner(name, info)
      if (owner?.kind === 'skill') found.add(`skill:${owner.name}`)
      // Plugin skills are children of their plugin
      if (owner?.kind === 'plugin' && bareName(owner.name) !== 'cockpit') {
        found.add(`plugin:${bareName(owner.name)}`)
        if (owner.skill) found.add(`skill:${owner.skill}`)
      }
    }
  })
  await step('mcp', t('disc.mcp'), async () => {
    for (const tool of await $.tool.list()) {
      const server = tool.mcp ? mcpServerOf(tool.name) : null
      // "cockpit" holds this mod's own tools; plugin servers are children of their plugin
      if (server && server !== 'cockpit') found.add(`mcp:${server}`)
    }
  })
  await step('agent', t('disc.agents'), async () => {
    for (const name of await agentFiles($)) if (!S.agents.has(name)) S.agents.set(name, { kind: 'agent', name })
    for (const owner of S.agents.values()) if (owner?.kind === 'agent') found.add(`agent:${owner.name}`)
  })
  const known = mergeKnown(S.known, found, failed)
  const isChanged = known.join('\n') !== S.known.join('\n')
  S.known = known
  await update($, knownA, () => known)
  // New sources or other plugins change what the gating decides; otherwise leave the prompt cache alone
  if (isChanged || gateBefore !== `${S.knownPlugins.join(',')}|${S.scopeOnly.join(',')}`) invalidateGating($)
  // The same error on every turn is reported once so a dismissed note stays dismissed
  const error = errors.join('; ')
  if (error && error !== S.discoverError) {
    $.ui.log(`cockpit: sources partly not read: ${error}`, { to: 'debug' })
    await note($, t('disc.partial', { error }))
  }
  S.discoverError = error
  await update($, cfgVerA, v => v + 1)
  await showStatus($)
}

// After a reload: list, grants and counters of the session are back before the first scan finishes
export async function restoreSession($: Eng): Promise<void> {
  S.known = [...(await read($, knownA))]
  S.sessionGrants = [...(await read($, grantsA))]
  S.uses = { ...(await read($, usesA)) }
}

async function saveGrants($: Eng): Promise<void> {
  await update($, grantsA, () => [...S.sessionGrants])
  await update($, usesA, () => ({ ...S.uses }))
}

export async function noteMcpServer($: Eng, server: string): Promise<void> {
  const key = `mcp:${server}`
  if (server === 'cockpit' || S.known.includes(key)) return
  S.known = [...S.known, key].sort()
  await update($, knownA, () => S.known)
  await update($, cfgVerA, v => v + 1)
}

export async function showStatus($: Eng): Promise<void> {
  const ci = ciShort(await read($, ciA))
  const g = groupSources(S.known, S.knownPlugins)
  const top = [...g.skills, ...g.plugins.map(p => p.key), ...g.mcps, ...g.agents]
  const on = top.filter(src => stateForKey(src) === 'on').length
  $.ui.status(t('status.line', { on, granted: S.sessionGrants.length, ci: ci ? ` · ${ci}` : '' }))
}

export async function ghPath($: Eng): Promise<string | null> {
  if (S.gh) return S.gh
  if (S.isGhMissing) return null
  for (const candidate of GH_PATHS) {
    try {
      if ((await $.process.run([candidate, '--version'], { timeoutMs: 5000 })).exitCode === 0) {
        S.gh = candidate
        return S.gh
      }
    } catch {
      // try the next candidate
    }
  }
  S.isGhMissing = true
  return null
}

// bin is set only when gh exists and is signed in. A failed sign-in probe is repeated after a minute,
// so signing in while the pane is open is picked up.
export async function ghReady($: Eng): Promise<{ bin: string; problem: null } | { bin: null; problem: GhProblem }> {
  const bin = await ghPath($)
  if (!bin) return { bin: null, problem: 'missing' }
  const now = await $.clock.now()
  if (!S.ghAuth || (!S.ghAuth.isOk && now - S.ghAuth.at >= GH_AUTH_RETRY_MS)) {
    let isOk = false
    try {
      // Only the active account counts: an invalid token of another account makes plain `auth status` exit 1.
      // gh before 2.40 has no --active and refuses the flag, then the plain probe decides.
      const active = await $.process.run([bin, 'auth', 'status', '--active', '--hostname', 'github.com'], { timeoutMs: 10_000 })
      isOk = active.exitCode === 0
      if (!isOk && /unknown flag/i.test(active.stderr)) {
        isOk = (await $.process.run([bin, 'auth', 'status', '--hostname', 'github.com'], { timeoutMs: 10_000 })).exitCode === 0
      }
    } catch {
      // treated as not signed in
    }
    S.ghAuth = { isOk, at: now }
  }
  return S.ghAuth.isOk ? { bin, problem: null } : { bin: null, problem: 'auth' }
}

export const hhmm = (at: number): string => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ghProblemText(problem: GhProblem, retryAt: number): string {
  return problem === 'rate' ? t('gh.rate', { time: hhmm(retryAt) }) : t(`gh.${problem}`)
}

// Doubles the polling wait (first the poll interval, at most 15 min); a hit while one is running changes nothing
async function noteRateLimit($: Eng): Promise<void> {
  const now = await $.clock.now()
  if (now < S.rateUntil) return
  const base = Math.max(S.cfg.settings.ciEverySec, 60) * 1000
  S.backoffMs = Math.min(BACKOFF_MAX_MS, S.backoffMs > 0 ? S.backoffMs * 2 : base * 2)
  S.rateUntil = now + S.backoffMs
}

// Every gh call that polls goes through here: rate limit hits start the backoff, a success ends it
export async function runGh($: Eng, bin: string, args: readonly string[], opts: { cwd?: string; timeoutMs: number }) {
  const res = await $.process.run([bin, ...args], opts)
  if (res.exitCode === 0) {
    S.backoffMs = 0
    S.rateUntil = 0
  } else if (isRateLimit(res.stderr)) await noteRateLimit($)
  return res
}

export type RepoId = { full: string; root: string; url: string }

const REMOTE = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|git@)github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i

// owner/name from an https or ssh remote of github.com
export const parseRemote = (remote: string): string | null => REMOTE.exec(remote.trim())?.[1] ?? null

async function lookupRepo($: Eng, root: string, remote: string | null | undefined): Promise<RepoId | null> {
  const bin = await ghPath($)
  if (bin) {
    try {
      const res = await runGh($, bin, ['repo', 'view', '--json', 'nameWithOwner,url'], { cwd: root, timeoutMs: 15_000 })
      if (res.exitCode === 0) {
        const view = JSON.parse(res.stdout) as { nameWithOwner?: unknown; url?: unknown }
        if (typeof view.nameWithOwner === 'string' && REPO_NAME.test(view.nameWithOwner)) {
          // Other hosts (GHES) are not github.com: gh calls without a host would reach a different repo of the same name
          if (typeof view.url !== 'string' || !view.url.startsWith('https://github.com/')) return null
          return { full: view.nameWithOwner, root, url: view.url }
        }
      }
    } catch {
      // fall back to the remote
    }
  }
  const full = remote ? parseRemote(remote) : null
  return full && REPO_NAME.test(full) ? { full, root, url: `https://github.com/${full}` } : null
}

// The GitHub repo of the session root, looked up once per root; a miss is looked up again next time
export async function currentRepo($: Eng): Promise<RepoId | null> {
  const repo = await $.session.repo().catch(() => null)
  if (!repo) return null
  const cached = S.repos.get(repo.root)
  if (cached) return cached
  const lookup = lookupRepo($, repo.root, repo.remote)
  S.repos.set(repo.root, lookup)
  const found = await lookup
  if (!found) S.repos.delete(repo.root)
  return found
}

// Owner for "All repos": the current repo's, else the signed-in user's (cached for 10 min)
export async function resolveOwner($: Eng, bin: string): Promise<string | null> {
  const here = await currentRepo($)
  if (here) return here.full.split('/')[0] ?? null
  const now = await $.clock.now()
  if (S.ownerCache && now - S.ownerCache.at < OWNER_CACHE_MS) return S.ownerCache.owner
  try {
    const res = await runGh($, bin, ['api', 'user', '--jq', '.login'], { timeoutMs: 15_000 })
    const login = res.stdout.trim()
    if (res.exitCode === 0 && /^[\w.-]+$/.test(login)) {
      S.ownerCache = { owner: login, at: now }
      return login
    }
  } catch {
    // no owner, no list
  }
  return null
}

// '' when HEAD is detached
export async function currentBranch($: Eng, root: string): Promise<string> {
  try {
    const res = await $.process.run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root, timeoutMs: 5000 })
    return res.exitCode === 0 ? res.stdout.trim() : ''
  } catch {
    return ''
  }
}

export async function hostOs($: Eng): Promise<'darwin' | 'linux' | 'windows'> {
  if (S.platform) return S.platform
  if ((await $.env.get('OS')) === 'Windows_NT') {
    S.platform = 'windows'
  } else {
    let name = ''
    try {
      name = (await $.process.run(['uname', '-s'], { timeoutMs: 5000 })).stdout.trim()
    } catch {
      // treated as Linux
    }
    S.platform = name === 'Darwin' ? 'darwin' : 'linux'
  }
  return S.platform
}

export function isAllowedUrl(url: string, pool: RunnerPool | undefined): boolean {
  if (url.startsWith('https://github.com/')) return true
  const host = httpsHost(url)
  return host !== null && [pool?.healthUrl, pool?.vmsUrl].some(u => u !== undefined && httpsHost(u) === host)
}

// Opens a GitHub or runner pool page in the default browser
export async function openUrl($: Eng, url: string): Promise<void> {
  if (!isAllowedUrl(url, S.cfg.settings.runnerPool)) {
    await note($, t('link.notOpened', { url: url.slice(0, 80) }))
    return
  }
  const os = await hostOs($)
  // cmd would take these as operators
  if (os === 'windows' && /[&|<>^"%\s]/.test(url)) {
    await note($, t('link.notOpened', { url: url.slice(0, 80) }))
    return
  }
  const argv = os === 'windows' ? ['cmd', '/c', 'start', '', url] : os === 'darwin' ? ['open', url] : ['xdg-open', url]
  const res = await $.process.run(argv, { timeoutMs: 10_000 })
  if (res.exitCode !== 0) await note($, t('browser.failed', { error: res.stderr.trim().slice(0, 120) }))
}

// Every change reads cockpit.json fresh (another session may have changed it), applies to that
// and writes; changes run one after another so none overwrites another. true: saved.
export function edit($: Eng, change: (c: CockpitConfig) => CockpitConfig): Promise<boolean> {
  const run = S.editChain.then(() => editNow($, change))
  S.editChain = run.catch(() => undefined)
  return run
}

async function editNow($: Eng, change: (c: CockpitConfig) => CockpitConfig): Promise<boolean> {
  let base = S.cfg
  if (S.cfgPath && (await $.fs.exists(S.cfgPath))) {
    const { parsed } = await readConfig($, S.cfg)
    if (parsed.error) {
      await note($, t(S.isCfgBroken ? 'cfg.brokenNothingSaved' : 'cfg.errorNothingSaved', { error: configErrorText(parsed.error) }))
      return false
    }
    base = parsed.config
    S.isCfgBroken = false
  } else if (S.isCfgBroken) {
    await note($, t('cfg.brokenNothingSaved'))
    return false
  }
  try {
    await saveConfig($, change(base))
  } catch (err) {
    await note($, t('cfg.writeFailed', { error: String(err).slice(0, 120) }))
    toast($, t('toast.saveFailed'))
    return false
  }
  await showStatus($)
  return true
}

export async function setSetting<K extends keyof CockpitSettings>($: Eng, key: K, value: CockpitSettings[K]): Promise<void> {
  await edit($, c => ({ ...c, settings: { ...c.settings, [key]: value } }))
}

export async function confirmThen($: Eng, key: string, run: () => void): Promise<void> {
  if ((await read($, confirmA)) === key) {
    await update($, confirmA, () => '')
    run()
  } else {
    await update($, confirmA, () => key)
  }
}

// The gating decision changed: ask for descriptions, attachments and prompt sections again
export function invalidateGating($: Eng): void {
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('prompt.attachment')
  $.ui.invalidate('prompt.section')
}

const isGranted = (source: string): boolean => S.sessionGrants.some(g => normKey(g) === normKey(source))

// The session grant that currently turns this owner on (its own or its plugin's)
export function grantFor(owner: Owner): string | undefined {
  const { own, parent } = keysOf(owner)
  return S.sessionGrants.find(g => normKey(g) === normKey(own) || (parent !== null && normKey(g) === normKey(parent)))
}

// Load a source for the session (call, mention or detour): one cache rebuild, toast, row under "Loaded"
export async function grantOnRequest($: Eng, sources: readonly string[], why: Key = 'toast.loaded'): Promise<void> {
  const fresh = sources.filter(src => !isGranted(src))
  for (const src of sources) S.uses[src] = (S.uses[src] ?? 0) + 1
  if (fresh.length > 0) {
    S.sessionGrants = [...S.sessionGrants, ...fresh]
    invalidateGating($)
    toast($, `${t(why)}: ${fresh.map(srcName).join(', ')}`)
    await showStatus($)
  }
  await saveGrants($)
  await update($, cfgVerA, v => v + 1)
}

export async function noteUse($: Eng, source: string): Promise<void> {
  S.uses[source] = (S.uses[source] ?? 0) + 1
  await saveGrants($)
  await update($, cfgVerA, v => v + 1)
}

// Without a grant the stored state applies again
export async function dropGrant($: Eng, source: string): Promise<void> {
  S.sessionGrants = S.sessionGrants.filter(g => normKey(g) !== normKey(source))
  delete S.uses[source]
  invalidateGating($)
  await saveGrants($)
  await showStatus($)
  await update($, cfgVerA, v => v + 1)
}

// Saves at once, globally or for this folder only; a session grant for this source is
// settled by that
export async function setSource($: Eng, source: string, state: State, isFolder = false): Promise<void> {
  const change = isFolder && S.folder ? (c: CockpitConfig) => setFolderState(c, S.folder, source, state) : (c: CockpitConfig) => setState(c, source, state)
  if (await edit($, change)) await dropGrant($, source)
}

export async function resetFolderSource($: Eng, source: string): Promise<void> {
  if (S.folder) await edit($, c => clearFolderState(c, S.folder, source))
}

export async function resetSource($: Eng, source: string): Promise<void> {
  await edit($, c => clearState(c, source))
}

// Turns a session grant into a stored state
export async function keepGrant($: Eng, source: string, isFolder = false): Promise<void> {
  await setSource($, source, 'on', isFolder)
}

export async function togglePlugin($: Eng, key: string): Promise<void> {
  S.openPlugins = S.openPlugins.includes(key) ? S.openPlugins.filter(k => k !== key) : [...S.openPlugins, key]
  await update($, cfgVerA, v => v + 1)
}
