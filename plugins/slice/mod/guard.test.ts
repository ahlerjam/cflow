import { expect, test, type Engine } from 'claude-code/testing'
import { isFrozen, isSliceState, runsTests, writesState } from './guard'
import { boot } from './kit'

const STATE = JSON.stringify({ startVersion: '2.1.312', proofs: { p: { cmd: 'make t', files: ['tests/proof.test.ts', './a.ts'] } }, misses: [] })
const ask = async ($: Engine, tool: string, input: object, agentId?: string): Promise<{ decision?: string; reason?: string; decider?: string }> => {
  if (!agentId) return $.tool.check({ tool, input }) // a query carries no agentId; only a call in an agent loop does
  const r = (await $.tool.call({ tool, ...input, agentId } as never)) as { isError?: boolean; text?: string }
  return { decision: r.isError ? 'deny' : 'allow', reason: r.text }
}
const bash = ($: Engine, command: string, id?: string) => ask($, 'Bash', { command }, id)
const write = ($: Engine, file_path: string, id?: string, content = 'x') => ask($, 'Write', { file_path, content }, id)
const v = async (...calls: Promise<{ decision?: string }>[]) => (await Promise.all(calls)).map(r => r.decision)
const setup = { marker: '{}', state: STATE }
test('pure checks', () => {
  for (const c of ['FOO="a b" npx -y vitest', './node_modules/.bin/vitest', 'bash -c "cd x && jest"', 'timeout 5 pytest', '(cargo test)', 'ls\ngo test', 'env A=1 uv run pytest', 'npm t', 'npm exec vitest', 'uvx pytest']) expect(runsTests(c)).toBe(true)
  for (const c of ['make test-affected FILES=a', 'echo vitest', 'npm install vitest', 'grep jest x', 'git commit -m pytest']) expect(runsTests(c)).toBe(false)
  expect([writesState('cat /r/.git/slice/state.json 2>&1', '/r/.git/slice'), writesState('cp /r/.git/slice/state.json /tmp/x', '/r/.git/slice'), writesState('cp x /r/.git/slice/state.json', '/r/.git/slice'), writesState('echo {} >> /r/.git/slice/log.jsonl', '/r/.git/slice')]).toEqual([false, false, true, true])
  expect([isSliceState('/x/.git/slice/notes.md', '/r/.git/slice'), isFrozen('/r/t/p.ts', ['./t/p.ts'], '/r'), isFrozen('/o/t/p.ts', ['t/p.ts'], '/r'), isFrozen('/r/p.ts', ['p.ts'], '/r'), isFrozen('/r/x/p.ts', ['p.ts'], '/r')]).toEqual([true, true, false, true, false])
})
test('without the marker nothing is checked', async ($, on) => {
  await boot($, on, { run: true })
  expect(await v(bash($, 'npx vitest'), write($, '/r/a.test.ts', undefined, 'it.skip(1)'))).toEqual(['allow', 'allow'])
})
test('skips and || true are denied with the fix, only where they matter; interactive is free', async ($, on) => {
  const { files } = await boot($, on, setup)
  files['/r/old.test.ts'] = 'it.skip(1)'
  expect((await write($, '/r/a.test.ts', undefined, 'it.skip ("x")')).reason).toContain('Fix: remove .skip')
  const mk = (p: string) => write($, p, undefined, 'x || true')
  expect(await v(mk('/r/Makefile'), mk('/r/.gitlab-ci.yml'), mk('/r/b.ts'), write($, '/r/src/a.ts', undefined, 'rx.skip(3)'), write($, '/r/x_test.go', undefined, 't.Skip("later")'), write($, '/r/old.test.ts', undefined, 'it.skip(1)\nok'), bash($, 'npx vitest && git push -f'))).toEqual(['deny', 'deny', 'allow', 'allow', 'deny', 'allow', 'allow'])
})
test('in a run runners, risky git and the verify skill are denied; make passes', async ($, on) => {
  await boot($, on, { ...setup, run: true })
  expect((await bash($, 'npx vitest run')).reason).toContain('make test-affected FILES=')
  const cmds = ['git commit --no-verify -m x', 'git commit -n -m x', 'git push origin +main', 'git push -fu', 'git config core.hooksPath x', '/usr/bin/git push --force']
  expect(await v(bash($, 'make test-affected FILES=a'), bash($, 'echo --no-verify'), write($, '/r/.claude/skills/verify/SKILL.md'), ...cmds.map(c => bash($, c)))).toEqual(['allow', 'allow', ...Array(7).fill('deny')])
})
test('slice state is write-protected; proofs, hooks and CI ask the person', async ($, on) => {
  await boot($, on, setup)
  expect(await v(bash($, 'echo x > /r/.git/slice/state.json'), write($, '/r/.git/slice/notes.md'), bash($, 'cat /r/.git/slice/state.json 2>&1'))).toEqual(['deny', 'deny', 'allow'])
  const r = await write($, '/r/tests/proof.test.ts')
  expect([r.decision, r.reason]).toEqual(['ask', expect.stringContaining('Fix: ask the person')])
  expect(await v(write($, '/r/.husky/pre-commit'), write($, '/r/.github/workflows/ci.yml'), write($, '/o/tests/proof.test.ts'), write($, '/r/GNUmakefile'), write($, '/r/package.json'), write($, '/r/.env.local'), write($, '/r/docs/adr/0001-db.md'))).toEqual(['ask', 'ask', 'allow', 'ask', 'ask', 'ask', 'ask'])
})
test('builders stay in a worktree of this repo, the verifier stays read-only', async ($, on) => {
  await boot($, on, setup)
  expect((await write($, '/r/src/a.ts', 'b1')).reason).toContain('work in your worktree')
  expect(await v(write($, '/wt/b.ts', 'b1'), write($, '/other/a.ts', 'b1'), write($, '/r/.git/slice/verify/t', 'v1'), write($, '/r/.git/slice/verify/../state.json', 'v1'), bash($, 'git -C /x stash', 'v1'), bash($, 'git diff', 'v1'))).toEqual(['allow', 'deny', 'allow', 'deny', 'deny', 'allow'])
})
test('a frozen proof is frozen in every worktree; a builder may only add its own verify-* target to the Makefile', async ($, on) => {
  await boot($, on, setup)
  const edit = (old_string: string, new_string: string) => ask($, 'Edit', { file_path: '/wt/Makefile', old_string, new_string }, 'b1')
  expect(await v(write($, '/wt/a.ts', 'b1'), edit('.PHONY: check', '.PHONY: check verify-x\nverify-x:\n\tnode x.mjs'), edit('check:\n\tnpx tsc', 'check:\n\ttrue'))).toEqual(['deny', 'allow', 'deny'])
})
test('a pass resets the count; five denials halt main, a stuck agent only itself', async ($, on) => {
  await boot($, on, setup)
  const bad = (id?: string) => write($, '/r/a.test.ts', id, 'it.skip(1)')
  for (let i = 0; i < 4; i++) await bad()
  await bash($, 'ls')
  for (let i = 0; i < 4; i++) await bad()
  expect((await bash($, 'ls')).decision).toBe('allow')
  for (let i = 0; i < 5; i++) await write($, '/r/x', 'v1')
  expect([(await bash($, 'ls', 'v1')).reason, (await bash($, 'ls')).decision]).toEqual([expect.stringContaining('stuck: permissions. v1'), 'allow'])
  for (let i = 0; i < 5; i++) await bad()
  expect((await bash($, 'ls')).reason).toMatch(/^stuck: permissions\. main was denied 5 times.*Fix:/)
})
