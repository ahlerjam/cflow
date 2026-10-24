import { atom, read } from 'claude-code'
import type { Color } from 'claude-code'

import { fit, fitLeft } from '../actions'
import { dropGrant, keepGrant, resetFolderSource, resetSource, resolve, resolveGlobal, setSource, togglePlugin } from '../core'
import { t } from '../i18n'
import { showSourcesScope, showSourcesView } from '../nav'
import { bareName, folderEntry, groupSources, norm, ownerOf } from '../sources'
import { SOURCES_SCOPES, SOURCES_VIEWS, S } from '../state'
import type { Eng } from '../state'
import { STATE_LABEL, STATE_W, dangerBtn, pill, pills, section, stateButtons } from './ui'
import { loadPlugins, pluginAction } from '../plugins-io'
import type { PaneView, Table } from './ui'
import type { SourcesScope, SourcesView } from '../../types'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const sourcesViewA = atom({ plugin: 'cockpit', key: 'sourcesView' } as const, 'overview')
const sourcesScopeA = atom({ plugin: 'cockpit', key: 'sourcesScope' } as const, 'global')

// Color and icon of the switches
const VIEW_LOOK: Record<SourcesView, { icon: string; color: Color }> = {
  overview: { icon: '☰', color: 'claude' },
  plugins: { icon: '⚙', color: 'merged' },
}
const SCOPE_LOOK: Record<SourcesScope, { icon: string; color: Color }> = {
  global: { icon: '◍', color: 'suggestion' },
  folder: { icon: '▣', color: 'remember' },
}
const folderName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

// The state the buttons show and set: global, or with the deviations of this folder
const shownOf = (src: string, isHere: boolean) => (isHere ? resolve : resolveGlobal)(ownerOf(src, S.knownPlugins))

export async function sourcesTab($: Eng, table: Table, pane: PaneView) {
  const { Box, Text } = table
  const view = await read($, sourcesViewA)
  // Without a known folder there is only "Global"
  const isHere = S.folder !== '' && (await read($, sourcesScopeA)) === 'folder'
  const W = Math.max(44, (pane.bodyColumns || 70) - 1)

  const g = groupSources(S.known, S.knownPlugins)
  const top = [...g.skills, ...g.plugins.map(p => p.key), ...g.mcps, ...g.agents]
  const saved = top.map(src => shownOf(src, isHere).saved)
  const nHere = Object.keys(S.folder ? (S.cfg.folders[S.folder] ?? {}) : {}).length
  // Header: views as a button row, below one tile per state with count and meaning (replaces a legend)
  const tiles: ReadonlyArray<{ id: string; icon: string; color: Color; n: number; what: string; hint: string }> = [
    { id: 'on', icon: '●', color: 'success', n: saved.filter(s => s === 'on').length, what: STATE_LABEL.on, hint: t('src.tileOn') },
    { id: 'off', icon: '○', color: 'inactive', n: saved.filter(s => s === 'off').length, what: STATE_LABEL.off, hint: t('src.tileOff') },
    { id: 'never', icon: '⊘', color: 'error', n: saved.filter(s => s === 'never').length, what: STATE_LABEL.never, hint: t('src.tileNever') },
    ...(S.sessionGrants.length > 0
      ? [{ id: 'load', icon: '↓', color: 'remember' as Color, n: S.sessionGrants.length, what: t('src.tileLoaded'), hint: t('src.tileLoadedHint') }]
      : []),
  ]
  // Tile width: border 2 + padding 2, gap between tiles 1
  const tileW = Math.max(14, Math.floor((W - (tiles.length - 1)) / tiles.length))
  const header = (
    <Box flexDirection="column" rowGap={1}>
      {pills(table, 'sources', view, SOURCES_VIEWS.map(v => ({ id: v.id, label: t(v.labelKey), ...VIEW_LOOK[v.id] })), id => void showSourcesView($, id as SourcesView))}
      {view !== 'plugins' && S.folder !== '' &&
        pills(table, 'scope', isHere ? 'folder' : 'global', SOURCES_SCOPES.map(sc => ({
          id: sc.id,
          label: t(sc.labelKey),
          ...SCOPE_LOOK[sc.id],
          // "Local" carries the folder name and the number of its deviations
          ...(sc.id === 'folder' ? { label: `${t(sc.labelKey)} · ${folderName(S.folderLabel)}`, ...(nHere > 0 ? { badge: `${nHere}` } : {}) } : {}),
        })), id => void showSourcesScope($, id as SourcesScope))}
      {view !== 'plugins' && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} width={W}>
          {tiles.map(tile => (
            <Box key={`tile-${tile.id}`} width={tileW} flexShrink={0} flexDirection="column" borderStyle="round" borderColor={tile.color} paddingX={1}>
              <Text>
                <Text bold color={tile.color}>{tile.icon} {tile.n}</Text>
                <Text bold> {tile.what}</Text>
              </Text>
              <Text dimColor>{fit(tile.hint, tileW - 4).trimEnd()}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )

  return (
    <Box flexDirection="column" rowGap={1}>
      {header}
      {view === 'plugins' ? pluginsView($, table, pane, W) : overview($, table, W, isHere)}
    </Box>
  )
}

// Each kind has its color for border, title and names; a plugin child takes the color of its kind
const KIND_COLOR: Record<string, Color> = { skill: 'suggestion', plugin: 'claude', mcp: 'merged', agent: 'planMode' }
const kindColor = (src: string): Color => KIND_COLOR[src.slice(0, src.indexOf(':'))] ?? 'claude'

// Columns of a row, separated by gaps of 1: ▸ 1 (child: indent 3) | dot 1 | name | Repo 4 | children 3 | on off never | ↺ 1
const FOLD_W = 1
const INDENT_W = 3
const MARK_W = 4
const COUNT_W = 3
const RESET_W = 1
// Below this name width the buttons move to their own line
const MIN_NAME_W = 12

type Row = {
  src: string
  // Plugin row (with ▸ and count) or child (indented, with ↺)
  kind: 'plain' | 'plugin' | 'child'
  name: string
  count?: number
  isRepo?: boolean
  // "Local" view: buttons show and set the deviation here
  isHere: boolean
}

// Child name without the plugin part: "superpowers:brainstorming" -> "brainstorming"
function childName(src: string, plugin: string): string {
  const name = src.slice(src.indexOf(':') + 1)
  if (src.startsWith('skill:')) return name.startsWith(`${plugin}:`) ? name.slice(plugin.length + 1) : name
  const prefix = `plugin_${norm(plugin)}_`
  return norm(name).startsWith(prefix) ? name.slice(prefix.length) : name
}

// One source: dot (effective), name, three buttons (saved); a click saves to cockpit.json at once
function sourceRow($: Eng, table: Table, inner: number, row: Row) {
  const { Box, Button, Text } = table
  const { src, kind, isHere } = row
  const owner = ownerOf(src, S.knownPlugins)
  // Dot: what applies in this session; buttons: the state of the view
  const r = resolve(owner)
  const shown = shownOf(src, isHere)
  const entry = S.folder ? folderEntry(S.cfg, S.folder, src) : undefined
  const isChild = kind === 'child'
  const isInherited = isHere ? entry === undefined : isChild && shown.via !== 'own'
  // ↺ deletes the deviation in "Local", globally the own state of a plugin child
  const hasReset = isChild || isHere
  const canReset = isHere ? entry !== undefined : isChild && shown.via === 'own'
  const dot = r.effective === 'on' ? '●' : r.effective === 'never' ? '⊘' : '○'
  const lead = kind === 'plugin' ? FOLD_W : isChild ? INDENT_W : 0
  const isPlugin = kind === 'plugin'
  const open = isPlugin && S.openPlugins.includes(src)
  const isFromPlugin = isChild && shown.via !== 'own'
  const label = `${row.name}${src.startsWith('mcp:') && isChild ? ' · MCP' : ''}${isFromPlugin ? t('src.fromPlugin') : ''}${!isHere && entry ? t('src.hereState', { state: STATE_LABEL[entry] }) : ''}`
  const extras = isPlugin ? MARK_W + COUNT_W : 0
  const btnW = STATE_W + (hasReset ? 1 + RESET_W : 0)
  // Buttons in the row, else (narrow pane) on a line of their own below
  const colsWide = (lead ? 1 : 0) + 2 + (isPlugin ? 2 : 0) + 1
  const wideName = inner - lead - 1 - extras - btnW - (colsWide - 1)
  const isWide = wideName >= MIN_NAME_W
  const nameW = isWide ? wideName : Math.max(MIN_NAME_W, inner - lead - 1 - extras - (colsWide - 2))
  const buttons = (
    <Box key={`row-btns-${src}`} flexDirection="row" columnGap={1} alignItems="center">
      <Box flexDirection="row" columnGap={1}>
        {stateButtons(table, `src-${src}`, shown.saved, isInherited, v => void setSource($, src, v, isHere))}
      </Box>
      {hasReset && (
        <Box width={RESET_W} flexShrink={0}>
          {canReset ? (
            <Button key={`src-reset-${src}`} plain label="↺" onPress={() => void (isHere ? resetFolderSource($, src) : resetSource($, src))} />
          ) : (
            <Text> </Text>
          )}
        </Box>
      )}
    </Box>
  )
  const head = (
    <Box flexDirection="row" columnGap={1} alignItems="center">
      {kind === 'plugin' && (
        <Box width={FOLD_W} flexShrink={0}>
          <Button key={`src-fold-${src}`} plain label={open ? '▾' : '▸'} onPress={() => void togglePlugin($, src)} />
        </Box>
      )}
      {isChild && <Box width={INDENT_W} flexShrink={0} />}
      <Box width={1} flexShrink={0}>
        <Text color={r.effective === 'on' ? 'success' : r.effective === 'never' ? 'error' : undefined} dimColor={r.effective === 'off'}>{dot}</Text>
      </Box>
      <Box width={nameW} flexShrink={0}>
        <Text bold={r.effective === 'on'} color={kindColor(src)} dimColor={r.effective !== 'on'} strikethrough={r.effective === 'never'}>{fit(label, nameW)}</Text>
      </Box>
      {isPlugin && (
        <Box width={MARK_W} flexShrink={0}>
          <Text color="remember">{row.isRepo ? t('src.repo') : ''}</Text>
        </Box>
      )}
      {isPlugin && (
        <Box width={COUNT_W} flexShrink={0}>
          <Text dimColor>{fitLeft(String(row.count ?? 0), COUNT_W)}</Text>
        </Box>
      )}
      {isWide && buttons}
    </Box>
  )
  return isWide ? (
    <Box key={`row-${src}`} flexDirection="column">{head}</Box>
  ) : (
    <Box key={`row-${src}`} flexDirection="column">
      {head}
      <Box flexDirection="row" paddingLeft={lead + 2}>{buttons}</Box>
    </Box>
  )
}

const isOn = (src: string): boolean => resolve(ownerOf(src, S.knownPlugins)).effective === 'on'

// Loaded (this session): every session grant with a counter; "keep on" saves it, "undo" drops it.
// Widths follow the longest label of the active locale (+4 for brackets and padding).
const keepW = (): number => Math.max(t('src.keepHere').length, t('src.keepOn').length) + 4
const dropW = (): number => t('src.drop').length + 4

function loadedBox($: Eng, table: Table, W: number, isHere: boolean) {
  const { Box, Text } = table
  if (S.sessionGrants.length === 0) return null
  const inner = W - 4
  const keep = keepW()
  const drop = dropW()
  const nameW = inner - keep - drop - 2
  const isWide = nameW >= 14
  return section(table, 'sources-loaded', t('src.loadedTitle'), 'remember',
    <Box flexDirection="column">
      {S.sessionGrants.map(src => {
        const uses = S.uses[src] ?? 1
        const name = `${src}${uses > 1 ? ` ×${uses}` : ''}`
        const buttons = [
          <Box key={`load-c1-${src}`} width={keep} flexShrink={0}>
            {pill(table, `load-keep-${src}`, isHere ? t('src.keepHere') : t('src.keepOn'), () => void keepGrant($, src, isHere), { color: 'success', variant: 'primary' })}
          </Box>,
          <Box key={`load-c2-${src}`} width={drop} flexShrink={0}>
            {pill(table, `load-drop-${src}`, t('src.drop'), () => void dropGrant($, src))}
          </Box>,
        ]
        return isWide ? (
          <Box key={`load-${src}`} flexDirection="row" columnGap={1} alignItems="center">
            <Box width={nameW} flexShrink={0}>
              <Text>{fit(name, nameW)}</Text>
            </Box>
            {buttons}
          </Box>
        ) : (
          <Box key={`load-${src}`} flexDirection="column">
            <Text>{fit(name, inner)}</Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap={1} paddingLeft={2}>{buttons}</Box>
          </Box>
        )
      })}
    </Box>,
    <Text dimColor>{S.sessionGrants.length}</Text>,
  )
}

// Overview: loaded, skills, plugins (collapsible), MCP servers, agents
function overview($: Eng, table: Table, W: number, isHere: boolean) {
  const { Box, Text } = table
  const inner = W - 4
  const g = groupSources(S.known, S.knownPlugins)
  const count = (list: readonly string[]) => <Text dimColor>{t('src.countOn', { n: list.filter(isOn).length, total: list.length })}</Text>
  const plain = (id: string, title: string, list: readonly string[]) =>
    list.length === 0 ? null : section(table, `sources-${id}`, title, kindColor(list[0] ?? ''),
      <Box flexDirection="column">{list.map(src => sourceRow($, table, inner, { src, kind: 'plain', name: src.slice(src.indexOf(':') + 1), isHere }))}</Box>,
      count(list),
    )
  const repo = (key: string) => S.scopeOnly.some(p => norm(bareName(p)) === norm(key.slice(7)))
  return (
    <Box flexDirection="column" rowGap={1}>
      {loadedBox($, table, W, isHere)}
      {S.known.length === 0 && <Text dimColor>{t('src.scanning')}</Text>}
      {plain('skills', t('src.skills'), g.skills)}
      {g.plugins.length > 0 && section(table, 'sources-plugins', t('src.plugins'), 'claude',
        <Box flexDirection="column">
          {g.plugins.map(p => {
            const name = p.key.slice(7)
            const rows = [sourceRow($, table, inner, { src: p.key, kind: 'plugin', name, count: p.children.length, isRepo: repo(p.key), isHere })]
            if (S.openPlugins.includes(p.key)) for (const c of p.children) rows.push(sourceRow($, table, inner, { src: c, kind: 'child', name: childName(c, name), isHere }))
            return <Box key={`plg-${p.key}`} flexDirection="column">{rows}</Box>
          })}
        </Box>,
        <Text dimColor>{t('src.countOn', { n: g.plugins.filter(p => isOn(p.key)).length, total: g.plugins.length })}</Text>,
      )}
      {plain('mcp', t('src.mcp'), g.mcps)}
      {plain('agents', t('src.agents'), g.agents)}
    </Box>
  )
}

// Plugins of this session: user scope and project/local of the current folder, one frame per scope
function pluginsView($: Eng, table: Table, pane: PaneView, W: number) {
  const { Box, Text } = table
  const inner = W - 4
  // Status 1 | name | origin | toggle | delete, four gaps. Button widths follow the longest label of the
  // active locale, including the confirm form (+4 brackets).
  const toggleW = Math.max(...[t('plg.disable'), t('plg.enable'), t('common.confirm', { title: t('plg.disableShort') }), t('common.confirm', { title: t('plg.enableShort') })].map(l => l.length)) + 4
  const deleteW = t('common.confirm', { title: t('plg.delete') }).length + 4
  const srcW = Math.min(20, Math.max(8, Math.floor(inner / 5)))
  const nameW = Math.max(12, inner - 1 - srcW - toggleW - deleteW - 4)
  const groups = [
    { scope: 'user', title: t('scope.global') },
    { scope: 'project', title: t('plg.repo') },
    { scope: 'local', title: t('plg.local') },
  ]
  return (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {S.pluginBusy !== '' && <Text color="warning">{S.pluginBusy}</Text>}
        {S.pluginError !== '' && <Text color="error">{S.pluginError}</Text>}
        <Box flexGrow={1} />
        {pill(table, 'plg-refresh', t('plg.refresh'), () => void loadPlugins($))}
      </Box>
      {S.plugins.length === 0 && S.pluginError === '' && <Text dimColor>{t('plg.loading')}</Text>}
      {groups.map(g => {
        const list = S.plugins.filter(p => p.scope === g.scope)
        if (list.length === 0) return null
        const on = list.filter(p => p.isEnabled).length
        return (
          <Box key={`plg-grp-${g.scope}`} flexDirection="column" borderStyle="round" paddingX={1}>
            <Box flexDirection="row" columnGap={1}>
              <Text bold color="claude">{g.title}</Text>
              <Text dimColor>
                {t('src.countOn', { n: on, total: list.length })}
              </Text>
            </Box>
            {list.map(p => {
              const [name = p.id, market = ''] = p.id.split('@')
              return (
                <Box key={`plg-${p.id}-${p.scope}`} flexDirection="row" columnGap={1} alignItems="center">
                  <Box width={1} flexShrink={0}>
                    <Text color={p.isEnabled ? 'success' : undefined} dimColor={!p.isEnabled}>{p.isEnabled ? '●' : '○'}</Text>
                  </Box>
                  <Box width={nameW} flexShrink={0}>
                    <Text bold={p.isEnabled} dimColor={!p.isEnabled}>{fit(name, nameW)}</Text>
                  </Box>
                  <Box width={srcW} flexShrink={0}>
                    <Text dimColor>{fit(market, srcW)}</Text>
                  </Box>
                  <Box width={toggleW} flexShrink={0}>
                    {p.scope === 'project' ? (
                      // Project scope lives in the checked-in .claude/settings.json: confirm first
                      dangerBtn($, table, pane.pending, `plg-tog-${p.id}-${p.scope}`, p.isEnabled ? t('plg.disableShort') : t('plg.enableShort'), () =>
                        void pluginAction($, p, p.isEnabled ? 'disable' : 'enable'),
                      )
                    ) : (
                      pill(table, `plg-tog-${p.id}-${p.scope}`, p.isEnabled ? t('plg.disable') : t('plg.enable'), () => void pluginAction($, p, p.isEnabled ? 'disable' : 'enable'), {
                        color: 'success',
                        variant: p.isEnabled ? 'secondary' : 'primary',
                      })
                    )}
                  </Box>
                  <Box width={deleteW} flexShrink={0}>
                    {dangerBtn($, table, pane.pending, `plg-del-${p.id}-${p.scope}`, t('plg.delete'), () => void pluginAction($, p, 'uninstall'))}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}
