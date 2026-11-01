import { mock, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
const OK = { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const RUN_PROFILE = {
  sandbox: { failIfUnavailable: true, excludedCommands: [], network: { allowedDomains: ['registry.test'] } },
}
const CLOUD_PROFILE = { permissions: { deny: ['Bash(git push*)'] }, sandbox: { enabled: false } }
export const ROOT = '/r'
export const DIR = '/r/.git/slice'
export type Reply = { exitCode?: number; stdout?: string; stderr?: string }
export type Opts = {
  marker?: string
  version?: string
  state?: string
  run?: boolean
  interactive?: boolean
  env?: Record<string, string>
  files?: Record<string, string>
  limits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  proc?: (argv: readonly string[]) => Reply | undefined
}
export async function boot($: Engine, on: On, opts: Opts = {}) {
  const files: Record<string, string> = { ...opts.files }
  const seed = [[`${ROOT}/.claude/slice.json`, opts.marker], [`${DIR}/state.json`, opts.state]]
  seed.forEach(([k, v]) => v && (files[k!] = v))
  const [runs, registered, tools]: [string[][], string[], string[]] = [[], [], []]
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/h', ...(opts.run ? { SLICE_RUN: '1' } : opts.env) })
  on('fs.exists', async (_, e) => ({ value: e.path in files }))
  on('fs.read', async (_, e) => {
    const stub = e.path.endsWith('/profiles/run.json') ? JSON.stringify(RUN_PROFILE)
      : e.path.endsWith('/profiles/cloud.json') ? JSON.stringify(CLOUD_PROFILE) : ''
    return { value: files[e.path] ?? stub }
  })
  on('fs.write', async (_, e) => ({ value: void (files[e.path] = e.text) }))
  on('process.run', async (_, e) => {
    runs.push([...e.argv])
    const [cmd, from, to] = e.argv
    const reply = opts.proc?.(e.argv)
    if (reply) return { value: { ...OK, stdout: '', ...reply } }
    if (cmd === 'sh' && from === '-c' && to?.startsWith('printf')) {
      files[e.argv[5]!] = (files[e.argv[5]!] ?? '') + e.argv[4] + '\n'
    }
    if (cmd === 'git') return { value: { ...OK, stdout: `${ROOT}\n${ROOT}/.git\n` } }
    if (cmd === 'mv' && from === '-f' && to) {
      files[e.argv[3] ?? ''] = files[to] ?? ''
      delete files[to]
    }
    return { value: { ...OK, stdout: '' } }
  })
  on('session.version', async () => ({ value: { version: opts.version ?? '2.1.312' } }))
  on('command.register', async (_, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('tool.register', async (_, e) => (tools.push(e.name), { value: { tool: `mcp__slice__${e.name}` } }))
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: opts.limits ?? [] } as never }))
  on('session.start', async (_, e) => e)
  const start = { cwd: ROOT, surface: 'terminal', isInteractive: !opts.run && (opts.interactive ?? true) }
  await $.session.start(start as never)
  return { files, runs, registered, tools }
}
