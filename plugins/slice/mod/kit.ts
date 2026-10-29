import { mock, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
export const ROOT = '/r'
export const DIR = '/r/.git/slice'
export type Opts = { marker?: string; version?: string; state?: string; run?: boolean; interactive?: boolean; env?: Record<string, string>; mvFails?: boolean; exec?: (argv: readonly string[]) => { stdout: string } | undefined }
export async function boot($: Engine, on: On, opts: Opts = {}) {
  const files: Record<string, string> = {}
  ;[[`${ROOT}/.claude/slice.json`, opts.marker], [`${DIR}/state.json`, opts.state]].forEach(([k, v]) => v && (files[k!] = v))
  const [runs, registered]: [string[][], string[]] = [[], []]
  mock.clock(on, { now: 0 })
  mock.env(on, opts.run ? { SLICE_RUN: '1' } : (opts.env ?? {}))
  on('fs.exists', async (_, e) => ({ value: e.path in files }))
  on('fs.read', async (_, e) => ({ value: files[e.path] ?? (e.path.endsWith('profiles/run.json') ? '{"permissions":{"allow":[]},"sandbox":{"filesystem":{"allowWrite":[]},"network":{"allowedDomains":[]}}}' : '') }))
  on('fs.write', async (_, e) => ({ value: void (files[e.path] = e.text) }))
  on('process.run', async (_, e) => {
    runs.push([...e.argv])
    const [cmd, from, to] = e.argv
    if (cmd === 'sh' && from === '-c' && to?.startsWith('printf')) files[e.argv[5]!] = (files[e.argv[5]!] ?? '') + e.argv[4] + '\n'
    const x = opts.exec?.(e.argv)
    if (x) return { value: { ...OK, ...x } }
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
  on('agent.spawn', async () => ({ agentId: 'w1', model: 'm' }) as never)
  on('agent.list', async () => ({ value: [{ id: 'b1', type: 'slice:builder' }, { id: 'v1', type: 'slice:verifier' }] as never }))
  on('tool.register', async (_, e) => ({ value: { tool: `mcp__slice__${e.name}` } }))
  on('session.start', async (_, e) => e)
  on('tool.call', async () => ({ result: 'ok' }) as never)
  on('tool.check', async () => ({ decision: 'allow' }))
  const store = new Map<string, unknown>()
  on('store.get', async (_, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_, e) => ({ value: void store.set(e.key, e.value) }))
  on('store.delete', async (_, e) => ({ value: void store.delete(e.key) }))
  on('skill.prompt', async (_, e) => ({ text: e.text }) as never)
  on('session.cwd', async () => ({ value: ROOT }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: !opts.run && (opts.interactive ?? true) } as never)
  return { files, runs, registered }
}
