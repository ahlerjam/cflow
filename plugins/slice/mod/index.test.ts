import { expect, test, type Engine } from 'claude-code/testing'
import { DIR, boot } from './kit'
import { lockArgv } from './lock'
import { modeOf, parseMarker, versionAtLeast } from './state'

const status = ($: Engine, command = 'slice-status', args = '') => $.command.run({ origin: { kind: 'composer' }, command, args } as never) as Promise<{ text: string }>
const check = ($: Engine) => $.tool.check({ tool: 'Bash', input: { command: 'ls' } })
const STATE = (startVersion: string) => JSON.stringify({ startVersion, proofs: {}, misses: [] })
test('without the marker every hook passes through and commands say so', async ($, on) => {
  const { runs, files, registered } = await boot($, on, { version: '2.0.1' })
  expect((await check($)).decision).toBe('allow')
  expect((await status($)).text).toContain('run /slice:setup')
  expect(registered).toEqual([])
  expect(Object.keys(files)).toEqual([])
  expect(runs.every(r => r[0] === 'git')).toBe(true)
})
test('the reader keeps known keys and rejects broken JSON with a fix', () => {
  expect(parseMarker('{"corePaths":["make"],"allowedDomains":[1,"a.org"],"other":1}')).toEqual({ corePaths: ['make'], allowedDomains: ['a.org'] })
  expect(() => parseMarker('{')).toThrow('Fix:')
})
test('compares against the minimum', () => {
  expect(['2.1.311', '2.2.0', '2.1.310', 'x'].map(v => versionAtLeast(v, '2.1.311'))).toEqual([true, true, false, false])
})
test('too old halts tool calls with the fix', async ($, on) => {
  await boot($, on, { marker: '{}', version: '2.1.300' })
  const r = await check($)
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('Fix: update Claude Code')
})
test('in a run a version different from the stored start version halts', async ($, on) => {
  await boot($, on, { marker: '{}', state: STATE('2.1.400'), env: { SLICE_RUN: '1' } })
  const r = await check($)
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('switch back to 2.1.400')
})
test('an interactive session never halts on a changed version', async ($, on) => {
  await boot($, on, { marker: '{}', state: STATE('2.1.400') })
  expect((await check($)).decision).toBe('allow')
})
test('a broken marker or state halts instead of throwing', async ($, on) => {
  await boot($, on, { marker: '{' })
  const r = await check($)
  expect(r.decision).toBe('deny')
  expect(r.reason).toContain('slice.json is not valid JSON')
  expect((await status($)).text).toContain('halted')
})
test('the same version passes', async ($, on) => {
  await boot($, on, { marker: '{}', state: STATE('2.1.312') })
  expect((await check($)).decision).toBe('allow')
})
test('subagent beats run beats interactive', () => {
  expect([modeOf('a1', true, true), modeOf(undefined, true, true), modeOf(undefined, false, true), modeOf(undefined, false, false)]).toEqual(['subagent', 'run', 'interactive', 'run'])
})
test('SLICE_RUN=1 shows in /slice-status', async ($, on) => {
  await boot($, on, { marker: '{}', env: { SLICE_RUN: '1' } })
  expect((await status($)).text).toContain('mode run')
})
test('state.json is written to a temp file and moved into place', async ($, on) => {
  const { files, runs } = await boot($, on, { marker: '{}' })
  expect(runs.find(r => r[0] === 'mv')).toEqual(['mv', '-f', expect.stringMatching(/state\.json\..*\.tmp$/), `${DIR}/state.json`])
  expect(JSON.parse(files[`${DIR}/state.json`] ?? '').startVersion).toBe('2.1.312')
  expect(Object.keys(files).some(k => k.endsWith('.tmp'))).toBe(false)
})
test('a failed mv removes the temp file', async ($, on) => {
  const { runs } = await boot($, on, { marker: '{}', mvFails: true })
  expect((await check($)).reason).toContain('could not replace state.json')
  expect(runs.find(r => r[0] === 'rm')).toEqual(['rm', '-f', expect.stringMatching(/\.tmp$/)])
})
test('/slice-miss appends to the state and the log', async ($, on) => {
  const { files, runs } = await boot($, on, { marker: '{}' })
  expect((await status($, 'slice-miss', 'forgot the lock')).text).toContain('noted')
  expect(JSON.parse(files[`${DIR}/state.json`] ?? '').misses).toEqual(['forgot the lock'])
  const log = runs.find(r => r[0] === 'sh')
  expect(log?.[5]).toBe(`${DIR}/log.jsonl`)
  expect(log?.[4]).toContain('"event":"miss"')
})
test('argv is passed positionally, never interpolated', () => {
  const argv = lockArgv(['make', 'check; rm -rf /'], { interactive: false })
  expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
  expect(argv.slice(3)).toEqual(['slice-lock', 'make', 'check; rm -rf /'])
  expect(argv[2]).not.toContain('rm -rf /')
  expect(argv[2]).toContain('"$@"')
})
test('interactive flag and wait seconds change the script', () => {
  const script = (o: { interactive: boolean; waitSec?: number }) => lockArgv(['true'], o)[2]
  expect(script({ interactive: true })).toContain('i=1')
  expect(script({ interactive: false })).toContain('i=0')
  expect(script({ interactive: false })).toContain('n=90')
  expect(script({ interactive: false, waitSec: 5 })).toContain('n=5')
  for (const bad of [NaN, Infinity, -3, 0]) expect(script({ interactive: false, waitSec: bad })).toContain('n=90')
})
