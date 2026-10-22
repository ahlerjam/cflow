import { atom, read, update } from 'claude-code'

import type { CockpitTab, SourcesScope, SourcesView } from '../types'
import { refreshCi, startCiTimer } from './actions-io'
import { discover, loadConfig, note, saveConfig, setSetting, showStatus, toast, edit } from './core'
import { DEFAULT_CONFIG } from './defaults'
import { refreshIssues } from './issues-io'
import { setMarker } from './sources'
import { loadPlugins } from './plugins-io'
import { t } from './i18n'
import { PANE, S, TITLE } from './state'
import type { Eng } from './state'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const confirmA = atom({ plugin: 'cockpit', key: 'confirm' } as const, '')
const tabA = atom({ plugin: 'cockpit', key: 'tab' } as const, 'sources')
const sourcesViewA = atom({ plugin: 'cockpit', key: 'sourcesView' } as const, 'overview')
const isPaneOpenA = atom({ plugin: 'cockpit', key: 'isPaneOpen' } as const, false)
const isClosedA = atom({ plugin: 'cockpit', key: 'isClosed' } as const, false)
const sourcesScopeA = atom({ plugin: 'cockpit', key: 'sourcesScope' } as const, 'global')

export async function openPane($: Eng, tab?: CockpitTab): Promise<boolean> {
  if (tab) await update($, tabA, () => tab)
  await update($, isClosedA, () => false)
  const isPlaced = (await $.ui.open({ id: PANE, title: TITLE })).isPlaced
  S.hasOpenedPane = true
  await update($, isPaneOpenA, () => true)
  return isPlaced
}

// The engine knows whether the pane is shown (also after a reload); the atom only makes the band redraw
export async function isPaneShown($: Eng): Promise<boolean> {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
}

export async function notePaneOpen($: Eng, isOpen: boolean): Promise<void> {
  if (isOpen) S.hasOpenedPane = true
  await update($, isPaneOpenA, () => isOpen)
}

// Closed by the person: no open on start until the session ends, not even after a reload
export async function notePaneClosed($: Eng): Promise<void> {
  await update($, isClosedA, () => true)
}

export async function isClosedByPerson($: Eng): Promise<boolean> {
  return read($, isClosedA)
}

export async function showTab($: Eng, tab: CockpitTab): Promise<void> {
  await update($, tabA, () => tab)
  await update($, confirmA, () => '')
  if (tab === 'issues') void refreshIssues($)
  if (tab === 'actions') void refreshCi($)
  if (tab === 'sources' || tab === 'settings') void discover($)
}

export async function showSourcesView($: Eng, view: SourcesView): Promise<void> {
  await update($, sourcesViewA, () => view)
  await update($, confirmA, () => '')
  if (view === 'plugins') void loadPlugins($)
}

export async function showSourcesScope($: Eng, scope: SourcesScope): Promise<void> {
  await update($, sourcesScopeA, () => scope)
  await update($, confirmA, () => '')
}

export async function addMarker($: Eng, text: string): Promise<void> {
  const i = text.indexOf('=')
  if (i <= 0) {
    await note($, t('note.markerFormat'))
    return
  }
  await edit($, c => setMarker(c, text.slice(0, i).trim(), text.slice(i + 1)))
}

// Writes directly, also when cockpit.json was broken
export async function resetConfig($: Eng): Promise<void> {
  S.isCfgBroken = false
  await saveConfig($, DEFAULT_CONFIG)
  await showStatus($)
  toast($, t('toast.configReset'))
}

export async function toggleDemo($: Eng): Promise<void> {
  await setSetting($, 'demo', !S.cfg.settings.demo)
  await refreshCi($)
  await refreshIssues($)
}

export async function reloadAll($: Eng): Promise<void> {
  S.gh = null
  S.isGhMissing = false
  S.ghAuth = null
  S.repos.clear()
  S.poolToken = undefined
  S.poolTokenFailedAt = 0
  S.ownerCache = null
  await loadConfig($)
  await discover($)
  startCiTimer($)
  toast($, t('toast.configReloaded'))
}
