import { mock, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
export const ROOT = '/r'
export const DIR = '/r/.git/slice'
export type Opts = { marker?: string; version?: string; state?: string; run?: boolean; interactive?: boolean; env?: Record<string, string>; mvFails?: boolean }
export async function boot($: Engine, on: On, opts: Opts = {}) {
  const files: Record<string, string> = {}
  if (opts.marker) files[`${ROOT}/.claude/slice.json`] = opts.marker
  if (opts.state) files[`${DIR}/state.json`] = opts.state
  const [runs, registered]: [string[][], string[]] = [[], []]
  mock.clock(on, { now: 0 })
  mock.env(on, opts.run ? { SLICE_RUN: '1' } : (opts.env ?? {}))
  on('fs.exists', async (_, e) => ({ value: e.path in files }))
  on('fs.read', async (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', async (_, e) => ({ value: void (files[e.path] = e.text) }))
  on('process.run', async (_, e) => {
    runs.push([...e.argv])
    const [cmd, from, to] = e.argv
    if (cmd === 'git') return { value: { ...OK, stdout: `${ROOT}\n${ROOT}/.git\n` } }
    if (e.argv[2]?.includes('rev-parse')) return { value: { ...OK, stdout: e.argv[4]?.startsWith('/wt') ? `/wt\n${ROOT}/.git\n` : e.argv[4]?.startsWith('/other') ? '/other\n/other/.git\n' : `${ROOT}\n${ROOT}/.git\n` } }
    if (cmd === 'mv' && opts.mvFails) return { value: { ...OK, exitCode: 1, stdout: '' } }
    if (cmd === 'mv' && from === '-f' && to) {
      files[e.argv[3] ?? ''] = files[to] ?? ''
      delete files[to]
    }
    return { value: { ...OK, stdout: '' } }
  })
  on('session.version', async () => ({ value: { version: opts.version ?? '2.1.312' } }))
  on('command.register', async (_, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('agent.list', async () => ({ value: [{ id: 'b1', type: 'slice:builder' }, { id: 'v1', type: 'slice:verifier' }] as never }))
  on('session.start', async (_, e) => e)
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('tool.check', async () => ({ decision: 'allow' }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: !opts.run && (opts.interactive ?? true) } as never)
  return { files, runs, registered }
}
