// Manage plugins through the CLI (`claude plugin ...`) in the session folder, so project and local scope are right.
import { atom, update } from 'claude-code'

import { discover, note, toast } from './core'
import { t } from './i18n'
import { isLspPlugin } from './sources'
import { S } from './state'
import type { Eng, PluginRow } from './state'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const cfgVerA = atom({ plugin: 'cockpit', key: 'configVersion' } as const, 0)
const confirmA = atom({ plugin: 'cockpit', key: 'confirm' } as const, '')


async function claudeBin($: Eng): Promise<string | null> {
  if (S.claudeBin) return S.claudeBin
  const home = (await $.env.get('HOME')) ?? ''
  const candidates = ['claude', ...(home ? [`${home}/.local/bin/claude`] : []), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']
  for (const candidate of candidates) {
    try {
      if ((await $.process.run([candidate, '--version'], { timeoutMs: 10_000 })).exitCode === 0) {
        S.claudeBin = candidate
        return candidate
      }
    } catch {
      // try the next candidate
    }
  }
  return null
}

// Project and local scope apply to the session folder, also in subfolders and worktrees
async function root($: Eng): Promise<string> {
  return $.session.root()
}

// All plugins of user scope, plus project/local scope of the current folder
export async function loadPlugins($: Eng): Promise<void> {
  const bin = await claudeBin($)
  if (!bin) {
    S.pluginError = t('plg.cliMissing')
    await update($, cfgVerA, v => v + 1)
    return
  }
  const cwd = await root($)
  const res = await $.process.run([bin, 'plugin', 'list', '--json'], { cwd, timeoutMs: 30_000 })
  if (res.exitCode !== 0) {
    S.pluginError = res.stderr.trim().slice(0, 160)
  } else {
    try {
      const rows = JSON.parse(res.stdout) as Array<Record<string, unknown>>
      S.plugins = rows
        .filter(r => r['scope'] === 'user' || r['projectPath'] === cwd)
        .map(r => ({
          id: String(r['id']),
          scope: String(r['scope']),
          // User scope counts "enabled", in a repo the switch of this project
          isEnabled: r['scope'] === 'user' ? r['enabled'] === true : (r['projectEnabled'] ?? r['enabled']) === true,
          hasServers: !!r['mcpServers'] || isLspPlugin(String(r['id'])),
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
      S.pluginError = ''
    } catch (err) {
      S.pluginError = t('plg.listUnreadable', { error: String(err).slice(0, 100) })
    }
  }
  await update($, cfgVerA, v => v + 1)
}

const BUSY = { enable: 'plg.busyEnable', disable: 'plg.busyDisable', uninstall: 'plg.busyUninstall' } as const
const DONE = { enable: 'plg.doneEnable', disable: 'plg.doneDisable', uninstall: 'plg.doneUninstall' } as const

export async function pluginAction($: Eng, row: PluginRow, action: 'enable' | 'disable' | 'uninstall'): Promise<void> {
  const bin = await claudeBin($)
  if (!bin) return
  await update($, confirmA, () => '')
  S.pluginBusy = t(BUSY[action], { id: row.id })
  await update($, cfgVerA, v => v + 1)
  const res = await $.process.run([bin, 'plugin', action, '-s', row.scope, row.id], { cwd: await root($), timeoutMs: 60_000 })
  S.pluginBusy = ''
  if (res.exitCode !== 0) {
    await note($, `${row.id}: ${(res.stderr || res.stdout).trim().slice(0, 160)}`)
  } else {
    toast($, t(DONE[action], { id: row.id }))
    // MCP and LSP servers change the tool set: without --force Claude Code does not apply the reload
    await reloadPlugins($, row.hasServers)
  }
  await loadPlugins($)
  await discover($)
}

// Reloads without the user typing; if that fails, a note names the command
export async function reloadPlugins($: Eng, isForce: boolean): Promise<void> {
  const args = isForce ? '--force' : ''
  try {
    await $.command.run({ command: 'reload-plugins', args })
  } catch (err) {
    $.ui.log(`cockpit: $.command.run(reload-plugins) rejected: ${String(err)}`, { to: 'debug' })
    await note($, t('plg.reloadFailed', { args: args ? ` ${args}` : '', error: String(err).slice(0, 80) }))
  }
}
