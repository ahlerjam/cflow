import type { EngineInterface } from 'claude-code'

type Eng = EngineInterface
export type Marker = { excludedCommands?: string[]; allowedDomains?: string[] }
export type Miss = { t: number; line: string }
export type State = { misses: Miss[] }
export type Mode = 'interactive' | 'run'

// Session facts shared by the mod files; `active` stays false without the marker
export const S = { active: false, interactive: false, isRun: false, marker: {} as Marker, dir: '', root: '', halt: '' }
export const modeOf = (isRun: boolean, interactive: boolean): Mode => (isRun || !interactive ? 'run' : 'interactive')
const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
export function parseMarker(text: string): Marker {
  const raw = (() => { try { return JSON.parse(text) } catch { throw new Error('slice: .claude/slice.json is not valid JSON. Fix: correct the file or delete it to switch slice off.') } })() as Record<string, unknown>
  return Object.fromEntries((['excludedCommands', 'allowedDomains'] as const).map(k => [k, strings(raw?.[k])]).filter(([, v]) => v))
}
export async function openRepo($: Eng, cwd: string): Promise<{ root: string; dir: string } | null> {
  const r = await $.process.run(['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
  const [root, common] = r.stdout.trim().split('\n')
  return r.exitCode === 0 && root && common ? { root, dir: `${common}/slice` } : null
}
export async function loadState($: Eng): Promise<State> {
  if (!(await $.fs.exists(`${S.dir}/state.json`))) return { misses: [] }
  try { return JSON.parse(await $.fs.read(`${S.dir}/state.json`)) } catch { throw new Error(`slice: state.json is not valid JSON. Fix: delete ${S.dir}/state.json outside the session.`) }
}
// Two sessions may write: temp file plus mv, so a reader never sees half a file
export async function saveState($: Eng, state: State): Promise<void> {
  const tmp = `${S.dir}/state.json.${await $.clock.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await $.process.run(['mkdir', '-p', S.dir])
  await $.fs.write(tmp, JSON.stringify(state, null, 2) + '\n')
  const moved = await $.process.run(['mv', '-f', tmp, `${S.dir}/state.json`])
  if (moved.exitCode !== 0) throw (await $.process.run(['rm', '-f', tmp]), new Error(`slice: could not replace state.json: ${moved.stderr.trim()}`))
}
export async function logEvent($: Eng, event: string, data: Record<string, unknown> = {}): Promise<void> {
  const line = JSON.stringify({ t: await $.clock.now(), event, ...data })
  await $.process.run(['mkdir', '-p', S.dir])
  await $.process.run(['sh', '-c', 'printf "%s\\n" "$1" >> "$2"', 'sh', line, `${S.dir}/log.jsonl`])
}
export async function tailLog($: Eng, n: number): Promise<string[]> {
  const path = `${S.dir}/log.jsonl`
  return (await $.fs.exists(path)) ? (await $.fs.read(path)).trim().split('\n').slice(-n) : []
}
