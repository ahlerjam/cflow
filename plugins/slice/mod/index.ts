import type { Register } from 'claude-code'

import { register as guard, resetDenials } from './guard'
import { TOOL, register as witness } from './witness'
import { MIN_VERSION, S, TYPES, loadState, logEvent, modeOf, openRepo, parseMarker, saveState, tailLog, versionAtLeast } from './state'
export { lockArgv } from './lock'
export { S, loadState, logEvent, modeOf, saveState } from './state'
export type { Marker, Mode, State } from './state'

const OFF = 'slice is not set up here (run /slice:setup)'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    ;[S.active, S.halt] = [false, '']
    resetDenials(), TYPES.clear()
    S.interactive = e.isInteractive
    S.isRun = (await $.env.get('SLICE_RUN')) === '1'
    const repo = await openRepo($, e.cwd)
    const markerPath = repo && `${repo.root}/.claude/slice.json`
    if (!repo || !markerPath || !(await $.fs.exists(markerPath))) return next(e)
    S.dir = repo.dir
    S.root = repo.root
    S.active = true
    await $.command.register({ name: 'slice-status', description: 'Show slice state, mode and recent log' })
    await $.command.register({ name: 'slice-miss', description: 'Note something the harness missed', argumentHint: '"<line>"' })
    await $.tool.register(TOOL)
    try {
      S.marker = parseMarker(await $.fs.read(markerPath))
      const { version } = await $.session.version()
      const state = (await loadState($)) ?? { startVersion: version, proofs: {}, misses: [] }
      if (!versionAtLeast(version, MIN_VERSION)) {
        S.halt = `slice needs Claude Code >= ${MIN_VERSION}, this is ${version}. Fix: update Claude Code.`
      } else if (modeOf(undefined, S.isRun, S.interactive) === 'run' && state.startVersion !== version) {
        S.halt = `Claude Code is ${version}, the run started on ${state.startVersion}. Fix: switch back to ${state.startVersion}, or delete ${S.dir}/state.json outside the session to accept ${version}.`
      } else {
        await saveState($, S.interactive ? { ...state, startVersion: version } : state)
      }
    } catch (err) {
      S.halt = err instanceof Error ? err.message : String(err)
    }
    if (S.halt) await logEvent($, 'halt', { reason: S.halt })
    return next(e)
  })

  // A failed hook counts as absent, so the catch turns a mod error into a deny
  on('tool.check', async (_$, e, next) => (S.active && S.halt && !/^(Read|Grep|Glob)$/.test(e.tool) ? { decision: 'deny', reason: S.halt } : next(e))).catch(($, e, next) => ({ decision: 'deny', reason: `slice guard failed: ${next.error}. Fix: restart the session.` }))

  on('agent.spawn', async (_$, e, next) => { const r = await next(e); return (r.agentId && TYPES.set(r.agentId, e.subagentType), r) })
  guard(on)
  witness(on)

  on('command.run', { command: 'slice-status' }, async $ => {
    if (!S.active) return { text: OFF }
    const { version } = await $.session.version()
    const lines = await tailLog($, 5)
    return { text: [`active, mode ${modeOf(undefined, S.isRun, S.interactive)}, Claude Code ${version}`, S.halt && `halted: ${S.halt}`, ...lines].filter(Boolean).join(' | ') }
  })

  on('command.run', { command: 'slice-miss' }, async ($, e) => {
    if (!S.active) return { text: OFF }
    const line = e.args.trim()
    if (!line) return { text: 'Usage: /slice-miss "<what the harness missed>"' }
    const state = await loadState($)
    if (!state) return { text: 'slice has no state yet. Fix: restart the session.' }
    await saveState($, { ...state, misses: [...state.misses, line] })
    await logEvent($, 'miss', { line })
    return { text: `noted (${state.misses.length + 1} misses)` }
  })
}
