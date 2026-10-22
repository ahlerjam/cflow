import type { EngineInterface, Timer } from 'claude-code'

import type { CockpitTab, SourcesScope, SourcesView } from '../types'
import { DEFAULT_CONFIG } from './defaults'
import type { Key, Locale } from './i18n'
import type { CockpitConfig, Owner, SkillInfo } from './sources'

export const PANE = 'cockpit'
export const TITLE = 'Cockpit'
export const SOURCES_SCOPES: ReadonlyArray<{ id: SourcesScope; labelKey: Key }> = [
  { id: 'global', labelKey: 'scope.global' },
  { id: 'folder', labelKey: 'scope.folder' },
]
export const SOURCES_VIEWS: ReadonlyArray<{ id: SourcesView; labelKey: Key }> = [
  { id: 'overview', labelKey: 'view.overview' },
  { id: 'plugins', labelKey: 'view.plugins' },
]
export const TABS: ReadonlyArray<{ id: CockpitTab; labelKey: Key }> = [
  { id: 'sources', labelKey: 'tab.sources' },
  { id: 'actions', labelKey: 'tab.actions' },
  { id: 'issues', labelKey: 'tab.issues' },
  { id: 'settings', labelKey: 'tab.settings' },
  { id: 'help', labelKey: 'tab.help' },
]
// Tab ids from earlier versions and their German names; stored atom values and /cockpit arguments may still carry them
const TAB_ALIASES: Record<string, CockpitTab> = {
  quellen: 'sources',
  jobs: 'sources',
  ci: 'actions',
  einstellungen: 'settings',
  anleitung: 'help',
}
export function normalizeTab(raw: string): CockpitTab | undefined {
  const id = raw.trim().toLowerCase()
  return TABS.find(tab => tab.id === id)?.id ?? TAB_ALIASES[id]
}
// Model alias for AI help: the engine resolves it like --model
export const AI_MODEL = 'sonnet'
// /health of the runner pool: fixed interval
export const HEALTH_EVERY_MS = 60_000
export const CI_INTERVAL_SECS = [0, 60, 90, 180, 300]
export const QUEUED_MINUTES = [3, 5, 10, 15, 30]
export const ISSUE_LIMITS = ['20', '40', '80', '100'].map(v => ({ value: v, label: v }))
export const SUMMARY_MODELS = ['haiku', 'sonnet'].map(v => ({ value: v, label: v === 'haiku' ? 'Haiku' : 'Sonnet' }))
// Rows summarized before the pane has reported its page size, and $.store entries kept
export const SUMMARY_ROWS = 15
export const SUMMARY_KEEP = 500
export const SUMMARY_INDEX = 'sumIndex'
// GitHub search returns at most this many hits in total
export const SEARCH_CAP = 1000
export const GH_PATHS = ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']
// "All repos": candidates fetched from GitHub, rows shown, and how long the list and the user lookup stay cached
export const ALL_REPOS_FETCH = 40
export const ALL_REPOS_SHOWN = 8
export const OWNER_CACHE_MS = 600_000
export const GH_AUTH_RETRY_MS = 60_000
export const BACKOFF_MAX_MS = 900_000
// Upper bound of the remembered run ids (watched, notified, queued alerts)
export const REMEMBER_MAX = 200

export type Eng = EngineInterface

export type PluginRow = { id: string; scope: string; isEnabled: boolean; hasServers: boolean }

// Module state: starts over on every reload, the atoms stay.
// An object instead of exported `let`: importers can assign fields.
export const S = {
  cfg: DEFAULT_CONFIG as CockpitConfig,
  cfgPath: '',
  locale: 'en' as Locale,
  // Locale of the registered /cockpit description, '' before the first registration
  commandLocale: '' as Locale | '',
  isInteractive: false,
  // Non-interactive runs (claude -p, worktree agents) are never filtered
  isGating: true,
  gh: null as string | null,
  plugins: [] as PluginRow[],
  // Sources set to "off" that were loaded for this session; gone with the session
  sessionGrants: [] as string[],
  // How often a loaded source was used since (calls and further mentions)
  uses: {} as Record<string, number>,
  openPlugins: [] as string[],
  // cockpit.json could not be read: save nothing until it is reloaded
  isCfgBroken: false,
  // Chain of saves so they run one after another
  editChain: Promise.resolve() as Promise<unknown>,
  help: null as { question: string; answer: string; isBusy: boolean } | null,
  pluginError: '',
  pluginBusy: '',
  claudeBin: null as string | null,
  skills: new Map<string, SkillInfo>(),
  agents: new Map<string, Owner | null>(),
  alerted: new Set<number>(),
  // Failed checks last seen per PR number
  lastFailed: new Map<number, number>(),
  // Runner pool token: undefined = not read yet; a failed read is retried after a pause
  poolToken: undefined as string | undefined,
  poolTokenFailedAt: 0,
  // Current repo per session root, by promise so concurrent callers share one lookup
  repos: new Map<string, Promise<{ full: string; root: string; url: string } | null>>(),
  isGhMissing: false,
  // gh auth status: ok or not, and when it was probed
  ghAuth: null as { isOk: boolean; at: number } | null,
  // Rate limit backoff: current wait (ms, 0 = none) and the time before which the timer does not poll
  backoffMs: 0,
  rateUntil: 0,
  platform: '' as '' | 'darwin' | 'linux' | 'windows',
  ownerCache: null as { owner: string; at: number } | null,
  allReposAt: 0,
  allReposOwner: '',
  // Runs of the current branch seen queued or running (key: id:attempt), and those already announced
  watched: new Set<string>(),
  // Time of the first run poll: later runs that end unseen are still announced
  firstPollAt: 0,
  notified: new Set<string>(),
  // Heavy refreshes start after the pane was opened once
  hasOpenedPane: false,
  inflight: new Map<string, Promise<void>>(),
  // All sources of this session (keys), the loaded plugins and those enabled only in project/local scope
  // Session folder (git root, else start folder) and how the pane shows it (~/…)
  folder: '',
  folderLabel: '',
  known: [] as string[],
  knownPlugins: [] as string[],
  scopeOnly: [] as string[],
  // Running source scan, whether another is needed afterwards, when the last began (ms)
  discovering: null as Promise<void> | null,
  isDiscoverDirty: false,
  lastDiscoverAt: 0,
  // Error text of the last scan ('' for none); an identical one is not reported again
  discoverError: '',
  ciTimer: null as Timer | null,
  healthTimer: null as Timer | null,
  allRepos: [] as string[],
  workflowRepo: '',
  // Generation of the running summary loop; a newer refresh makes the older loop stop
  sumGen: 0,
  // Issues per page the Issues tab last rendered; only these are summarized
  issueRows: SUMMARY_ROWS,
  // False once GitHub rejected issueType/subIssues (for example GHES without issue types)
  hasNativeFields: true,
}
