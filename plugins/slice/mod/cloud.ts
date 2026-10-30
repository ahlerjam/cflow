import type { EngineInterface as Eng } from 'claude-code'
import { S, events, git, loadState, type State } from './state'

// Run state travels as branches slice-state/<stage>-<what> holding only state.json; cloud sessions push branches, not other refs
async function hasOrigin($: Eng) { return (await $.process.run(['git', '-C', S.root, 'remote', 'get-url', 'origin'])).exitCode === 0 }
export async function pushState($: Eng, st: State, what: 'queue' | 'status'): Promise<void> {
  if (!S.marker.cloud || !(await hasOrigin($))) return
  const pipe = (text: string, ...args: string[]) => $.process.run(['sh', '-c', 't=$1; r=$2; shift 2; printf "%s" "$t" | git -C "$r" "$@"', 'sh', text, S.root, ...args]).then(r => r.stdout.trim())
  const blob = await pipe(JSON.stringify(st, null, 2), 'hash-object', '-w', '--stdin')
  const tree = await pipe(`100644 blob ${blob}\tstate.json\n`, 'mktree')
  const commit = await git($, S.root, 'commit-tree', tree, '-m', `slice ${st.run!.stage} ${what}`)
  await git($, S.root, 'push', '-q', '-f', 'origin', `${commit}:refs/heads/slice-state/${st.run!.stage}-${what}`)
}

// Hybrid: the local session hands the whole approved stage to one cloud session, which runs it with the slice-cloud skill
export async function sendRun($: Eng, st: State): Promise<string> {
  const r = st.run!
  await git($, S.root, 'push', '-q', 'origin', `${r.branch}:${r.branch}`)
  await pushState($, st, 'queue')
  const brief = `Run the approved slice stage ${r.stage} with the project skill slice-cloud (.claude/skills/slice-cloud/SKILL.md): its queue is on the branch slice-state/${r.stage}-queue. Follow the skill to the end.`
  const p = await $.process.run(['script', '-q', '/dev/null', 'claude', '--cloud', brief], { cwd: S.root, timeoutMs: 180000 })
  return /(session_\w+|cse_\w+)/.exec(p.stdout)?.[1] ?? ''
}
export async function cloudStatus($: Eng): Promise<string> {
  if (!S.marker.cloud || !(await hasOrigin($))) return ''
  const refs = (await $.process.run(['git', '-C', S.root, 'ls-remote', 'origin', 'refs/heads/slice-state/*-status'])).stdout.trim().split('\n').filter(Boolean)
  const [out, st, ev] = [[] as string[], await loadState($), await events($)]
  // A local run pushes its status too: list it here only when it was sent to the cloud
  const local = st?.run && !ev.some(e => e.event === 'cloud-run' && e.stage === st.run!.stage) ? `/${st.run.stage}-status` : '\0'
  for (const line of refs.filter(l => !l.endsWith(local))) {
    const [sha, ref] = line.split('\t')
    if ((await $.process.run(['git', '-C', S.root, 'fetch', '-q', 'origin', ref!])).exitCode !== 0) continue
    const st = await $.process.run(['git', '-C', S.root, 'show', `${sha}:state.json`]).then(r => JSON.parse(r.stdout || '{}') as State, () => ({}) as State)
    const q = st.run?.queue ?? []
    const by = (s: string) => q.filter(x => x.status === s).map(x => x.id).join(', ') || '-'
    out.push(`cloud run ${st.run?.stage}: merged ${by('merged')} | waiting for you ${by('stuck')} | queued ${by('queued')}; the work is on origin/slice/${st.run?.stage}`)
  }
  return out.join('\n')
}
