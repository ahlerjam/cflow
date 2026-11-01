import type { EngineInterface as Engine, Register } from 'claude-code'

import { S, loadState, logEvent, modeOf, openRepo, parseMarker, saveState, tailLog } from './state'
export { S, loadState, logEvent, modeOf, saveState } from './state'
export type { Marker, Mode, State } from './state'

const OFF = 'slice is not set up here (run /slice:setup)'
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    ;[S.active, S.halt] = [false, '']
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
    try {
      S.marker = parseMarker(await $.fs.read(markerPath))
    } catch (err) {
      S.halt = err instanceof Error ? err.message : String(err)
      await logEvent($, 'marker-error', { reason: S.halt })
    }
    return next(e)
  })
  on('command.run', { command: 'slice-status' }, async $ => {
    if (!S.active) return { text: OFF }
    const { version } = await $.session.version()
    const lines = await tailLog($, 5)
    return { text: [`active, mode ${modeOf(S.isRun, S.interactive)}, Claude Code ${version}`, S.halt && `marker problem: ${S.halt}`, ...lines].filter(Boolean).join('\n') }
  })
  on('command.run', { command: 'slice-miss' }, async ($, e) => {
    if (!S.active) return { text: OFF }
    const line = e.args.trim()
    if (!line) return { text: 'Usage: /slice-miss "<what the harness missed>"' }
    const state = await loadState($)
    await saveState($, { ...state, misses: [...state.misses, { t: await $.clock.now(), line }] })
    await logEvent($, 'miss', { line })
    return { text: `noted (${state.misses.length + 1} misses). ${await proposeRule($, line)}` }
  })
}
// The rule goes in only with the person's yes; a full section drops the line the person picks
async function proposeRule($: Engine, miss: string): Promise<string> {
  const file = ['CLAUDE.local.md', 'AGENTS.md'].map(f => `${S.root}/${f}`)
  const path = (await Promise.all(file.map(async f => ((await $.fs.exists(f)) && /^## Verification/m.test(await $.fs.read(f)) ? f : '')))).find(Boolean)
  if (!path || !S.interactive) return 'No rule proposed (no verification section or no person to ask).'
  const rule = (await $.model.complete({ model: 'haiku', prompt: `One imperative rule, at most 110 characters, for a repo's verification section, that would have prevented this miss: ${miss}\nAnswer with the rule only.` }).then(r => (r.isAnswered ? r.text : ''), () => '')).trim().replace(/^[-*]\s*/, '')
  if (!rule) return 'No rule proposed.'
  const text = await $.fs.read(path)
  const [head, body = ''] = text.split(/^(?=## Verification)/m).length > 1 ? [text.slice(0, text.search(/^## Verification/m)), text.slice(text.search(/^## Verification/m))] : [text, '']
  const end = body.slice(3).search(/^## /m)
  const [sec, rest] = end < 0 ? [body, ''] : [body.slice(0, end + 3), body.slice(end + 3)]
  const lines = sec.trimEnd().split('\n')
  const ok = await $.ui.ask(`slice: add this rule to the verification section? "${rule}"`, ['Add the rule', 'Keep only the miss']).catch(() => '')
  if (ok !== 'Add the rule') return 'Kept only the miss.'
  let kept = lines
  if (lines.length >= 15) {
    const rules = lines.filter(l => l.startsWith('- ')).slice(0, 3)
    const drop = await $.ui.ask('slice: the section has 15 lines. Which rule does the new one replace?', [...rules.map(r => r.slice(0, 60)), 'Cancel']).catch(() => 'Cancel')
    if (drop === 'Cancel') return 'Kept only the miss.'
    kept = lines.filter(l => !l.startsWith(drop))
  }
  await $.fs.write(path, `${head}${[...kept, `- ${rule}`].join('\n')}\n${rest ? `\n${rest}` : ''}`)
  return (await logEvent($, 'rule', { rule, path }), `Added to ${path.slice(S.root.length + 1)}: ${rule}`)
}
