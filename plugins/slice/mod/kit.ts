import { mock, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
export const ROOT = '/r'
export const DIR = '/r/.git/slice'
export type Opts = { marker?: string; version?: string; state?: string; run?: boolean; interactive?: boolean; env?: Record<string, string> }
export async function boot($: Engine, on: On, opts: Opts = {}) {
  const files: Record<string, string> = {}
  ;[[`${ROOT}/.claude/slice.json`, opts.marker], [`${DIR}/state.json`, opts.state]].forEach(([k, v]) => v && (files[k!] = v))
  const [runs, registered]: [string[][], string[]] = [[], []]
  mock.clock(on, { now: 0 })
  mock.env(on, opts.run ? { SLICE_RUN: '1' } : (opts.env ?? {}))
  on('fs.exists', async (_, e) => ({ value: e.path in files }))
  on('fs.read', async (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', async (_, e) => ({ value: void (files[e.path] = e.text) }))
  on('process.run', async (_, e) => {
    runs.push([...e.argv])
    const [cmd, from, to] = e.argv
    if (cmd === 'sh' && from === '-c' && to?.startsWith('printf')) files[e.argv[5]!] = (files[e.argv[5]!] ?? '') + e.argv[4] + '\n'
    if (cmd === 'git') return { value: { ...OK, stdout: `${ROOT}\n${ROOT}/.git\n` } }
    if (cmd === 'mv' && from === '-f' && to) {
      files[e.argv[3] ?? ''] = files[to] ?? ''
      delete files[to]
    }
    return { value: { ...OK, stdout: '' } }
  })
  on('session.version', async () => ({ value: { version: opts.version ?? '2.1.312' } }))
  on('command.register', async (_, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('session.start', async (_, e) => e)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: !opts.run && (opts.interactive ?? true) } as never)
  return { files, runs, registered }
}
