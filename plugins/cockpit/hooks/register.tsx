import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { MCP_HEADING, agentOwner, filterMcpInstructions, filterSkillListing, findRedirect, folderStates, hintOf, loadSource, lspAllowed, lspOwner, mcpOwner, mcpServerOf, neverReason, norm, redirectHint, requestedSources, skillOwner, sourceSuggestions } from './sources'
import type { Owner } from './sources'
import { refreshLight, startCiTimer } from './actions-io'
import { discover, grantFor, grantOnRequest, loadConfig, note, noteMcpServer, noteUse, readFolder, readPlugins, refreshSkills, registerCommand, resolve, restoreSession, showStatus, stateFor, stateForKey } from './core'
import { describeSuggestion, t } from './i18n'
import { defaultSourcesScope, isClosedByPerson, isPaneShown, notePaneClosed, notePaneOpen, openPane, showTab } from './nav'
import { S, TABS, normalizeTab } from './state'
import type { Eng } from './state'
import { actionsTab } from './tabs/actions'
import { issuesTab } from './tabs/issues'
import { sourcesTab } from './tabs/sources'
import { settingsTab } from './tabs/settings'
import { helpTab } from './tabs/help'

// A literal in this file so the loader can read the hook matchers (id, requestId); same value as PANE in state.ts
const PANE = 'cockpit'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const cfgVerA = atom({ plugin: 'cockpit', key: 'configVersion' } as const, 0)
const confirmA = atom({ plugin: 'cockpit', key: 'confirm' } as const, '')
const noticeA = atom({ plugin: 'cockpit', key: 'notice' } as const, '')
const tabA = atom({ plugin: 'cockpit', key: 'tab' } as const, 'sources')
const isPaneOpenA = atom({ plugin: 'cockpit', key: 'isPaneOpen' } as const, false)

// MCP servers and plugin skills report in late after start: scan twice, then on every turn
const LATE_DISCOVER_MS = [5_000, 20_000]
const TURN_DISCOVER_MS = 30_000
const logDiscover = ($: Eng, err: unknown) =>
  $.ui.log(`cockpit: sources not discovered: ${String(err)}`, { to: 'debug' })

// Server name from "## <name>" of the MCP instructions: known servers, mod servers, claude.ai connectors and plugin servers
function isMcpName(name: string): boolean {
  const n = norm(name)
  const known = [...S.known, ...Object.keys(S.cfg.states), ...Object.keys(folderStates(S.cfg, S.folder))]
    .filter(src => src.startsWith('mcp:'))
    .map(src => norm(src.slice(4)))
  return n === 'cockpit' || n.startsWith('claude_ai_') || n.startsWith('plugin_') || known.includes(n)
}

// The same decision as tool.describe and tool.check, for the instructions of one server
const mcpNote = (n: number): string => `(Cockpit: ${n} MCP instructions hidden. Tools of servers set to "off" load on first call.)`
const isMcpOn = (name: string): boolean => stateFor(mcpOwner(name, S.knownPlugins)) === 'on'

// Skills without an owner (built-in) always stay visible
const isSkillOn = (name: string): boolean => {
  const owner = skillOwner(name, S.skills.get(name))
  return owner === null || stateFor(owner) === 'on'
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    S.isInteractive = e.isInteractive
    S.isGating = e.isInteractive
    await loadConfig($)
    // A reload fires session.start again: loaded sources and the source list stay
    await restoreSession($)
    await readFolder($, e.cwd).catch(err => logDiscover($, err))
    await defaultSourcesScope($)
    // Before the first prompt: the gating assigns plugin servers and repo plugins by it
    await readPlugins($).catch(err => logDiscover($, err))
    await refreshSkills($).catch(err => logDiscover($, err))
    await registerCommand($)
    await showStatus($)

    await notePaneOpen($, (await $.ui.panes()).some(p => p.id === PANE))
    if (S.isInteractive) {
      void (async () => {
        for (const ms of LATE_DISCOVER_MS) {
          await $.clock.sleep(ms)
          await discover($)
        }
      })().catch(err => logDiscover($, err))
      void refreshLight($)
      startCiTimer($)
      if (S.cfg.settings.openOnStart && !(await isClosedByPerson($))) void openPane($)
    }
    // The status line is only right after the first scan
    void discover($).catch(err => logDiscover($, err))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every main-conversation turn scans again, at most every 30 s: newly connected servers, new skills and agents
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && S.isInteractive && (await $.clock.now()) - S.lastDiscoverAt > TURN_DISCOVER_MS) {
      void discover($).catch(err => logDiscover($, err))
    }
    return next(e)
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') await notePaneClosed($)
    const out = await next(e)
    // A reload closes and reopens the pane itself: no button then
    if (e.origin.kind !== 'unload') await notePaneOpen($, false)
    return out
  }).catch(($, e, next) => next(e))


  on('command.run', { command: 'cockpit' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const tab = normalizeTab(arg) ?? TABS.find(tb => t(tb.labelKey).toLowerCase() === arg)?.id
    if (tab) await showTab($, tab)
    const isPlaced = await openPane($)
    return { text: t(isPlaced ? 'cmd.opened' : 'cmd.waiting') }
  })


  on('prompt.submit', async ($, e, next) => {
    const isPerson = (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !e.isMeta
    if (!S.isGating || !isPerson) return next(e)
    // A source set to "off" that the prompt names or types as /command loads until session end
    // (saying it once is enough). "never" is ignored.
    const asked = requestedSources(S.known, e.text, src => stateForKey(src) === 'off', S.knownPlugins)
    const cmdOwner = e.command ? skillOwner(e.command.name, S.skills.get(e.command.name)) : null
    if (cmdOwner && stateFor(cmdOwner) === 'off') asked.push(loadSource(cmdOwner))
    const fresh = [...new Set(asked)]
    if (fresh.length) await grantOnRequest($, fresh, 'toast.loadedOnAsk')
    return fresh.length
      ? next({ ...e, context: [...(e.context ?? []), `[cockpit] Loaded on request until session end: ${fresh.join(', ')}.`] })
      : next(e)
  }).catch(($, e, next) => next(e))

  // Tab completion: ";gar" suggests matching skills, plugins, MCP servers and agents
  on('prompt.autocomplete', { token: /^;\p{L}/u }, async ($, e, next) => {
    const own = await next(e)
    if (!S.isGating || e.token.length > 40 || /[/.~]/.test(e.token)) return own
    const rows = sourceSuggestions(S.known, e.token, stateForKey, describeSuggestion)
    return { suggestions: [...own.suggestions, ...rows] }
  })


  on('prompt.attachment', async ($, e, next) => {
    if (!S.isGating) return next(e)

    // Language server diagnostics only with an LSP plugin that is on
    if (/diagnostic/i.test(e.type) && !lspAllowed(S.knownPlugins, stateFor)) return { text: null }

    // MCP instructions of hidden servers when they arrive as an attachment (the type name is not in the typings: the text decides)
    if (e.type !== 'skill_listing' && typeof e.text === 'string' && (/mcp/i.test(e.type) || MCP_HEADING.test(e.text)) && /^## /m.test(e.text)) {
      const r = filterMcpInstructions(e.text, isMcpOn, isMcpName, !MCP_HEADING.test(e.text), mcpNote)
      if (r.hidden.length > 0) return next({ ...e, text: r.text })
    }

    if (e.type === 'skill_listing') {
      const { text, hidden } = filterSkillListing(e.text, isSkillOn, name => S.skills.size === 0 || S.skills.has(name))
      if (hidden.length === 0) return next(e)
      // Only "off" goes into the tail: Claude knows it exists and the Skill tool loads it on call. "never" stays hidden.
      const off = hidden.filter(name => {
        const owner = skillOwner(name, S.skills.get(name))
        return owner !== null && stateFor(owner) === 'off'
      })
      const tail = off.length ? `\n(Cockpit: off, loads when invoked via the Skill tool: ${off.join(', ')})` : ''
      return next({ ...e, text: `${text}${tail}` })
    }

    if (e.origin.kind === 'hook' && e.origin.event === 'SessionStart') {
      for (const [plugin, marker] of Object.entries(S.cfg.startupMarkers)) {
        if (e.text.includes(marker) && stateFor({ kind: 'plugin', name: plugin }) !== 'on') {
          return { text: null }
        }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The "# MCP Server Instructions" section of the system prompt: its name is not in the typings,
  // so there is no matcher and it is recognized by its heading
  on('prompt.section', async ($, e, next) => {
    const out = await next(e)
    if (!S.isGating || !out.text || !MCP_HEADING.test(out.text)) return out
    const r = filterMcpInstructions(out.text, isMcpOn, isMcpName, false, mcpNote)
    return r.hidden.length > 0 ? { text: r.text } : out
  }).catch(($, e, next) => next(e))

  on('tool.describe', async ($, e, next) => {
    const server = mcpServerOf(e.tool)
    if (server) await noteMcpServer($, server)
    if (!S.isGating) return next(e)
    const isLsp = e.tool === 'LSP'
    if (!server && !isLsp) return next(e)
    const owner = isLsp ? (lspOwner(S.knownPlugins, stateFor)?.owner ?? null) : mcpOwner(server ?? '', S.knownPlugins)
    if (owner === null) return next(e)
    const state = stateFor(owner)
    if (state === 'on') return next(e)
    const described = await next(e)
    const hint = hintOf(S.cfg, owner)
    return {
      ...described,
      isDeferred: true,
      description: `${state === 'never' ? `[Cockpit: never${hint ? ` – ${hint}` : ''}]` : '[Cockpit: off; loads on first call.]'} ${described.description}`,
    }
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    if (!S.isGating) return next(e)
    // Bash detour: stop it and load the matching source so Claude takes it without asking
    const cmd = e.tool === 'Bash' ? (e.input as { command?: unknown } | null)?.command : undefined
    const detour = typeof cmd === 'string' ? findRedirect(S.cfg, cmd, S.known, src => stateForKey(src) === 'never') : null
    if (detour) {
      if (stateForKey(detour.source) === 'off') await grantOnRequest($, [detour.source], 'toast.redirectLoaded')
      return {
        decision: 'deny',
        reason: `Cockpit: Stop, do not take this detour through Bash. ${detour.source} covers it and is loaded now. Use ${redirectHint(detour.source)} and carry on without asking.`,
      }
    }
    const input = (e.input ?? {}) as Record<string, unknown>
    let owner: Owner | null = null
    let what = e.tool

    const server = mcpServerOf(e.tool)
    if (server) {
      owner = mcpOwner(server, S.knownPlugins)
    } else if (e.tool === 'LSP') {
      // The LSP tool belongs to the LSP plugins: the best one decides
      owner = lspOwner(S.knownPlugins, stateFor)?.owner ?? null
      what = 'LSP'
    } else if (e.tool === 'Skill' && typeof input['skill'] === 'string') {
      const name = input['skill'].replace(/^\//, '')
      if (!S.skills.has(name)) await refreshSkills($)
      owner = skillOwner(name, S.skills.get(name))
      what = `Skill ${name}`
    } else if ((e.tool === 'Agent' || e.tool === 'Task') && typeof input['subagent_type'] === 'string') {
      const name = input['subagent_type']
      owner = S.agents.get(name) ?? (name.includes(':') ? { kind: 'plugin', name: name.split(':')[0] ?? name } : null)
      what = `Agent ${name}`
    }
    if (owner === null) return next(e)

    const r = resolve(owner)
    if (r.effective === 'on') {
      const grant = r.via === 'session' ? grantFor(owner) : undefined
      if (grant) await noteUse($, grant)
      return next(e)
    }
    if (r.effective === 'never') return { decision: 'deny', reason: neverReason(what, hintOf(S.cfg, owner)) }
    // "off" only pre-sorts: what Claude calls loads until session end (a plugin skill loads only itself)
    await grantOnRequest($, [loadSource(owner)])
    return next(e)
  }).catch(($, e, next) => next(e))

  // Only "never" is not offered; an agent set to "off" stays callable and loads on call
  on('agent.offer', async ($, e, next) => {
    if (!S.isGating) return next(e)
    const owner = agentOwner(e.agent, e.source, e.provider.plugin)
    S.agents.set(e.agent, owner)
    // Own agents are only known once the engine offers them
    const key = owner?.kind === 'agent' ? `agent:${owner.name}` : ''
    if (key && !S.known.includes(key)) {
      S.known = [...S.known, key].sort()
      await update($, cfgVerA, v => v + 1)
    }
    if (owner !== null && stateFor(owner) === 'never') return { isOffered: false }
    return next(e)
  }).catch(($, e, next) => next(e))


  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    // Read so opening and closing redraw the band; the engine knows whether the pane is shown
    await read($, isPaneOpenA)
    if (await isPaneShown($)) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Button
          key="band-open"
          label={t('band.open')}
          onPress={async () => {
            if (!(await openPane($))) $.ui.toast(t('cmd.waiting'))
          }}
        />
      </Box>
    )
  })


  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const stored = await read($, tabA)
    // Atoms survive a reload: an old value ('jobs', 'edit') shows the sources
    const tab = normalizeTab(stored) ?? 'sources'
    await read($, cfgVerA)
    const notice = await read($, noticeA)
    const pending = await read($, confirmA)
    const pane = { pending, bodyColumns: e.props.bodyColumns, rows: e.viewport?.rows }

    const tabs = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {TABS.map(tb => (
          <Button
            key={`tab-${tb.id}`}
            label={t(tb.labelKey)}
            variant={tab === tb.id ? 'primary' : 'secondary'}
            onPress={() => void showTab($, tb.id)}
          />
        ))}
      </Box>
    )

    // An error in one tab must not break the whole pane: the tab bar stays, the error shows in the tab
    let body
    try {
      if (tab === 'sources') body = await sourcesTab($, table, pane)
      else if (tab === 'actions') body = await actionsTab($, table, pane)
      else if (tab === 'issues') body = await issuesTab($, table, pane)
      else if (tab === 'help') body = await helpTab($, table, pane)
      else body = await settingsTab($, table, pane)
    } catch (err) {
      $.ui.log(`cockpit: tab ${tab} failed to render: ${String(err)}`, { to: 'debug' })
      body = <Text color="error">{t('pane.tabError', { error: String(err).slice(0, 200) })}</Text>
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="column">
          {tabs}
          <Text dimColor wrap="truncate-end">{'─'.repeat(Math.max(10, e.props.bodyColumns || 40))}</Text>
        </Box>
        {notice !== '' && (
          <Box flexDirection="row" columnGap={1}>
            <Text color="warning">{notice}</Text>
            <Button key="notice-ok" plain label="×" onPress={() => void note($, '')} />
          </Box>
        )}
        {body}
      </Box>
    )
  })
}
