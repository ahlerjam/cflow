import { expect, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DIR, boot } from './kit'
import { allowed, scan } from './witness'

const add = (f: string, ...l: string[]) => `diff --git a/${f} b/${f}\nnew file mode 100644\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1 @@\n${l.map(x => '+' + x).join('\n')}\n`
let [tree, diff, code, spawned] = ['t1', '', 0, 0]
const setup = async ($: Engine, on: On) => {
  on('process.spawn', async function* () { spawned++; yield { stream: 'stdout' as const, text: code === 3 ? 'slice-lock: waited 90 s\n' : 'ran\n' }; return { value: { code, signal: null } } })
  const exec = (a: readonly string[]) => (a[3] === 'write-tree' ? { stdout: tree } : a[3] === 'diff' ? { stdout: diff } : a.length === 6 ? { stdout: a[2]?.startsWith('/o') ? '/o/.git' : '/r/.git' } : undefined)
  return boot($, on, { marker: '{}', exec })
}
const slice = async ($: Engine, args: object) => ((await $.tool.call({ tool: 'mcp__slice__slice', ...args } as never)) as { result?: string }).result ?? ''
test('scans reject placeholders, assertion-less tests and stray Markdown; the allowlist is closed', () => {
  expect(scan(add('a.ts', '// TO' + 'DO later'))).toEqual(['a.ts: TODO/FIXME left in'])
  expect(scan(add('a.test.ts', "it('x', () => { run() })"))).toEqual(['a.test.ts: test without a value assertion'])
  expect(scan(add('a.test.ts', "it('x', () => { expect(run()).toBe(1) })"))).toEqual([])
  expect([scan(add('notes.md', 'x')).length, scan(add('docs/adr/1.md', 'x')).length, scan(add('s.py', 'raise NotImpl' + 'ementedError')).length]).toEqual([1, 1, 1])
  expect([allowed('make verify-x FILE=a', {}), allowed('make verify; rm', {}), allowed('npm test', {}), allowed('npm test', { p: { cmd: 'npm test' } })]).toEqual([true, false, false, true])
})
test('prove rejects a bad diff, a foreign command and a foreign cwd before running anything', async ($, on) => {
  await setup($, on)
  diff = add('a.test.ts', "it('x', () => { run() })")
  expect(await slice($, { action: 'prove' })).toContain('a.test.ts: test without a value assertion')
  diff = ''
  expect([await slice($, { action: 'prove', cmd: 'rm -rf x' }), await slice($, { action: 'prove', cmd: 'make verify SHELL=/x' })].join()).toContain('freeze it first')
  expect(await slice($, { action: 'prove', cwd: '/o/wt' })).toContain('git worktree add')
  expect(spawned).toBe(0)
})
test('a pass is cached per tree, a failure never is', async ($, on) => {
  await setup($, on)
  expect(await slice($, { action: 'prove' })).toMatch(/^\[slice harness\] PASS make verify on t1 \(\d+s\)/)
  expect(await slice($, { action: 'prove' })).toContain('cached from')
  expect(spawned).toBe(1)
  ;[tree, code] = ['t2', 1]
  expect(await slice($, { action: 'prove', cwd: '/wt/a' })).toMatch(/FAIL make verify \(exit 1\)\nran/)
  code = 3
  expect(await slice($, { action: 'prove', cwd: '/wt/a' })).toMatch(/^\[slice harness\] BUSY make verify/)
  expect(spawned).toBe(3)
})
test('done needs a pass on the current tree, the verdict of its level, and for high a pass the verifier recorded', async ($, on) => {
  await setup($, on)
  ;[tree, code] = ['t3', 0]
  expect(await slice($, { action: 'done', level: 'low' })).toContain('run slice prove again, the tree changed')
  await slice($, { action: 'prove' })
  const d = (level: string, verdict?: string) => slice($, { action: 'done', level, verdict })
  expect([await d('medium'), await d('high', 'pass'), await d('medium', 'skip'), await d('low')]).toEqual([expect.stringContaining("Medium: run /code-review high, or pass verdict 'skip'"), expect.stringContaining('High needs a pass the slice:verifier recorded'), ...Array(2).fill('[slice harness] done')])
  expect([await slice($, { action: 'verdict', verdict: 'pass', agentId: 'b1' }), await slice($, { action: 'prove', agentId: 'v1' }), (await $.agent.spawn({ prompt: 'p', subagentType: 'slice:verifier' }), await slice($, { action: 'verdict', verdict: 'pass', agentId: 'w1' }))]).toEqual([expect.stringContaining('only the slice:verifier'), expect.stringContaining('verifier only records a verdict'), '[slice harness] verdict pass recorded for t3'])
  expect([await d('high'), (await slice($, { action: 'verdict', verdict: 'fail', agentId: 'v1' }), await d('high')), (tree = 't4', await d('low'))]).toEqual(['[slice harness] done', expect.stringContaining('High needs'), expect.stringContaining('tree changed')])
})
test('note freezes a proof that prove then accepts', async ($, on) => {
  const { files } = await setup($, on)
  expect(await slice($, { action: 'note', cmd: 'npm test', files: ['a.ts'] })).toContain('needs a make command')
  await slice($, { action: 'note', cmd: 'make smoke', files: ['a.ts'], text: 'p' })
  expect(JSON.parse(files[`${DIR}/state.json`]!).proofs.p).toEqual({ cmd: 'make smoke', files: ['a.ts'] })
  expect(await slice($, { action: 'prove', cmd: 'make smoke' })).toContain('PASS make smoke')
})
