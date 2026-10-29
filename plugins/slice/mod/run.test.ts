import { expect, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'
import { DIR, boot } from './kit'
import { parseQueue, runnable } from './run'
import type { Run, State } from './state'

let [out, code, limits] = ['', 1, [] as { kind: string; percentUsed: number; resetsAt?: string }[]]
const setup = async ($: Engine, on: On, opts: { run?: boolean; state?: State } = {}) => {
  limits = []
  on('process.spawn', async function* () { yield { stream: 'stdout' as const, text: out }; return { value: { code, signal: null } } })
  on('session.usage', async () => ({ value: { startedAt: 0, rateLimits: limits } }) as never)
  const exec = (a: readonly string[]) => (a[3] === 'write-tree' ? { stdout: 't1' } : a[3] === 'diff' ? { stdout: '' } : a.length === 6 ? { stdout: '/r/.git' } : a[0] === 'sh' && a[2]?.includes('df -Pk') ? { stdout: String(99 * 1024 * 1024) } : undefined)
  return boot($, on, { marker: '{}', exec, run: opts.run, state: opts.state && JSON.stringify(opts.state) })
}
const slice = async ($: Engine, args: object) => ((await $.tool.call({ tool: 'mcp__slice__slice', ...args } as never)) as { result?: string }).result ?? ''
const S1 = (id: string, kind = 'feature', extra = {}) => ({ id, kind, claim: 'c', brief: 'b', ...extra })
const RUN = (q: object[]) => ({ ...(parseQueue({ stage: 's', budget: 10, slices: q }) as Run), wt: '/r', t0: 1, use0: 10 })

test('red needs a failed assertion before the code exists, then freezes the proof files', async ($, on) => {
  const { files } = await setup($, on)
  ;[out, code] = ['Error: Cannot find module ./x', 1]
  expect(await slice($, { action: 'red', files: ['t.test.ts'] })).toContain('not a failed assertion')
  ;[out, code] = ['AssertionError: expected 3 to be 4', 1]
  expect(await slice($, { action: 'red', files: ['t.test.ts'] })).toContain('frozen t.test.ts')
  expect(Object.values(JSON.parse(files[`${DIR}/state.json`]!).proofs)).toEqual([{ cmd: 'make verify', files: ['t.test.ts'] }])
  ;[out, code] = ['ok', 0]
  expect(await slice($, { action: 'red', files: ['t.test.ts'] })).toContain('Not red: make verify passes before the code exists')
})
test('a bug closes only after its proof failed first; a project skill named code-review is no review', async ($, on) => {
  await setup($, on)
  ;[out, code] = ['ok', 0]
  await slice($, { action: 'prove' })
  expect(await slice($, { action: 'done', level: 'low', kind: 'bug' })).toContain('needs make verify to FAIL before the fix')
  await $.skill.prompt({ skill: 'code-review', text: '', source: 'projectSettings' } as never)
  expect(await slice($, { action: 'done', level: 'medium' })).toContain('Medium needs /code-review')
})
test('amend opens a frozen proof exactly once and needs a reason', async ($, on) => {
  await setup($, on, { state: { startVersion: '2.1.312', proofs: { p: { cmd: 'make verify', files: ['a.ts'] } }, misses: [] } })
  expect([await slice($, { action: 'amend', text: 'p' }), await slice($, { action: 'amend', text: 'p', verdict: 'wrong value' }), await slice($, { action: 'amend', text: 'p', verdict: 'again' })]).toEqual([expect.stringContaining('say why'), expect.stringContaining('open for one change'), expect.stringContaining('amended once already')])
})
test('the queue is ordered by kind, checked, and runs only what its dependencies allow', () => {
  expect(parseQueue({ stage: 'bad id', slices: [] })).toContain('stage needs an id')
  expect(parseQueue({ stage: 's', slices: [S1('a', 'nope')] })).toContain('needs kind')
  const r = RUN([S1('p', 'polish'), S1('f', 'feature', { after: ['t'] }), S1('t', 'tracer'), S1('u', 'feature', { ui: true })])
  expect(r.queue.map(x => x.id)).toEqual(['t', 'f', 'u', 'p'])
  expect(runnable(r)?.id).toBe('t')
  r.queue[0]!.status = 'running'
  expect(runnable(r)?.id).toBe('u')
  r.hold = 10
  expect(runnable(r, 5)?.id).toBe('p')
})
test('exits: spend and the weekly reserve halt, the 5-hour window pauses, then the next slice starts', async ($, on) => {
  const { runs } = await setup($, on, { run: true, state: { startVersion: '2.1.312', proofs: {}, misses: [], run: RUN([S1('a')]) } })
  const cmd = (c: string) => $.command.run({ origin: { kind: 'composer' }, command: c, args: '' } as never) as Promise<{ text: string }>
  limits = [{ kind: 'spend_limit', percentUsed: 100 }]
  expect(await slice($, { action: 'start', text: 'online' })).toContain('halted: spend or credit limit reached')
  const at = async (l: typeof limits) => ((limits = l), (await cmd('slice-resume')).text)
  expect([await at([{ kind: 'seven_day', percentUsed: 71 }]), await at([{ kind: 'seven_day', percentUsed: 50 }]), await at([{ kind: 'five_hour', percentUsed: 91, resetsAt: 'T' }]), await at([])]).toEqual([expect.stringContaining('7-day reserve'), expect.stringContaining('three times the stage budget'), 'paused until T', expect.stringContaining('started slice a (1/1)')])
  expect(runs.find(r => r[0] === 'claude')?.slice(0, 5)).toEqual(['claude', '--bg', '--name', 'slice-s-1', '--settings'])
})
test('only an interactive session queues; a merge needs the verifier pass; a run adds at most 30 %', async ($, on) => {
  await setup($, on, { run: true, state: { startVersion: '2.1.312', proofs: {}, misses: [], run: RUN([S1('a'), S1('b'), S1('c')]) } })
  expect(await slice($, { action: 'queue', stage: { stage: 's', slices: [S1('a')] } })).toContain('approved by the person')
  expect(await slice($, { action: 'merge', id: 'a' })).toContain('stuck')
  expect(await slice($, { action: 'merge', id: 'zz' })).toContain('no such slice')
  expect(await slice($, { action: 'add', stage: S1('d'), text: 'needed' })).toContain('already added 30 %')
})
test('a reject queues a fix slice, a miss and a calibration example', async ($, on) => {
  const { files } = await setup($, on, { state: { startVersion: '2.1.312', proofs: {}, misses: [], run: RUN([S1('a')]) } })
  expect(await slice($, { action: 'accept', id: 'a', verdict: 'reject' })).toContain('reject with text')
  expect(await slice($, { action: 'accept', id: 'a', verdict: 'reject', text: 'too slow' })).toContain('queued a-fix1')
  const st = JSON.parse(files[`${DIR}/state.json`]!) as State
  expect([st.run!.queue.map(x => `${x.id}:${x.status}`), st.misses, st.calibration]).toEqual([['a:rejected', 'a-fix1:queued'], [{ t: 0, line: 'a: too slow' }], ['a: verifier passed, person rejected: too slow']])
})
