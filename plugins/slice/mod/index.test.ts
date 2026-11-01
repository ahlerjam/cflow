import { expect, test, type Engine } from 'claude-code/testing'
import { DIR, boot } from './kit'

const run = ($: Engine, command = 'slice-status', args = '') => $.command.run({ origin: { kind: 'composer' }, command, args } as never) as Promise<{ text: string }>

test('without the marker no command is registered', async ($, on) => {
  const { registered } = await boot($, on)
  expect(registered).toEqual([])
})
test('without the marker nothing is written', async ($, on) => {
  const { files, runs } = await boot($, on)
  expect(Object.keys(files)).toEqual([])
  expect(runs.every(r => r[0] === 'git')).toBe(true)
})
test('without the marker /slice-status points to setup', async ($, on) => {
  await boot($, on)
  expect((await run($)).text).toContain('run /slice:setup')
})
test('with the marker both commands are registered', async ($, on) => {
  const { registered } = await boot($, on, { marker: '{}' })
  expect(registered).toEqual(['slice-status', 'slice-miss'])
})
test('/slice-status reports interactive mode and the Claude Code version', async ($, on) => {
  await boot($, on, { marker: '{}' })
  expect((await run($)).text).toBe('active, mode interactive, Claude Code 2.1.312')
})
test('SLICE_RUN=1 shows as run mode in /slice-status', async ($, on) => {
  await boot($, on, { marker: '{}', env: { SLICE_RUN: '1' } })
  expect((await run($)).text).toContain('mode run')
})
test('/slice-status shows the last log lines', async ($, on) => {
  await boot($, on, { marker: '{}' })
  await run($, 'slice-miss', 'one')
  expect((await run($)).text).toContain('"event":"miss"')
})
test('a broken marker is reported in /slice-status', async ($, on) => {
  await boot($, on, { marker: '{' })
  expect((await run($)).text).toContain('slice.json is not valid JSON')
})
test('/slice-miss stores the line in state.json', async ($, on) => {
  const { files } = await boot($, on, { marker: '{}' })
  await run($, 'slice-miss', 'forgot the lock')
  expect(JSON.parse(files[`${DIR}/state.json`] ?? '').misses).toEqual([{ t: 0, line: 'forgot the lock' }])
})
test('/slice-miss appends a miss event to the log', async ($, on) => {
  const { runs } = await boot($, on, { marker: '{}' })
  await run($, 'slice-miss', 'forgot the lock')
  const log = runs.find(r => r[0] === 'sh')
  expect(log?.[5]).toBe(`${DIR}/log.jsonl`)
  expect(log?.[4]).toContain('"event":"miss"')
})
test('/slice-miss without a line prints usage', async ($, on) => {
  await boot($, on, { marker: '{}' })
  expect((await run($, 'slice-miss', '  ')).text).toContain('Usage')
})
