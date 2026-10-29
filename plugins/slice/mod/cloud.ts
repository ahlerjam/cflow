import type { EngineInterface as Eng } from 'claude-code'
import { S, git, logEvent, saveState, type Slice, type State } from './state'

// Run state travels as refs/slice/<stage>-<what>: a commit holding state.json, so no product branch carries it
async function hasOrigin($: Eng) { return (await $.process.run(['git', '-C', S.root, 'remote', 'get-url', 'origin'])).exitCode === 0 }

export async function pushState($: Eng, st: State, what: 'queue' | 'status'): Promise<void> {
  if (!S.marker.cloud || !(await hasOrigin($))) return
  const pipe = (text: string, ...args: string[]) => $.process.run(['sh', '-c', 't=$1; r=$2; shift 2; printf "%s" "$t" | git -C "$r" "$@"', 'sh', text, S.root, ...args]).then(r => r.stdout.trim())
  const blob = await pipe(JSON.stringify(st, null, 2), 'hash-object', '-w', '--stdin')
  const tree = await pipe(`100644 blob ${blob}\tstate.json\n`, 'mktree')
  const commit = await git($, S.root, 'commit-tree', tree, '-m', `slice ${st.run!.stage} ${what}`)
  await git($, S.root, 'push', '-q', '-f', 'origin', `${commit}:refs/slice/${st.run!.stage}-${what}`)
}

// Mixed mode: the cloud builds, proves with the nested mod and pushes slice-<id>; the local run verifies and merges
export async function dispatch($: Eng, st: State, x: Slice): Promise<string> {
  const r = st.run!
  await git($, S.root, 'push', '-q', 'origin', `${r.branch}:${r.branch}`)
  const nested = `SLICE_RUN=1 SLICE_SLICE=${x.id} claude -p --plugin-dir .slice/plugin --settings .slice/plugin/profiles/cloud.json --permission-mode dontAsk`
  const brief = [
    `Slice ${x.id} of slice run ${r.stage}, mixed mode. You only dispatch; do not edit code yourself.`,
    `1. git fetch origin ${r.branch} && git checkout -B ${r.branch} origin/${r.branch}`,
    `2. Run, with the prompt on stdin: ${nested}`,
    `   Prompt: Run the workflow /slice:feature with args ${JSON.stringify({ id: x.id, claim: x.claim, brief: x.brief, proof: x.proof, risk: x.risk, kind: x.kind, ui: x.ui, base: r.branch })}. Print its result.`,
    `3. If the result says verified: git push origin slice-${x.id}. Otherwise push nothing.`,
    `4. Send one PushNotification: "slice ${r.stage}: ${x.id} built in the cloud" or "slice ${r.stage}: ${x.id} stuck in the cloud".`,
  ].join('\n')
  const p = await $.process.run(['script', '-q', '/dev/null', 'claude', '--cloud', brief], { cwd: S.root })
  const id = /(session_\w+|cse_\w+)/.exec(p.stdout)?.[1]
  if (!id) return `could not start the cloud session for ${x.id}: ${p.stdout.slice(-300)}`
  Object.assign(x, { status: 'cloud', t: await $.clock.now(), why: `cloud ${id}` })
  return (await saveState($, st), await logEvent($, 'cloud', { slice: x.id, session: id }), `sent ${x.id} to the cloud (${id})`)
}

// A pushed slice-<id> brings the slice back as queued: the local session proves it and runs the verifier on that tree
export async function pickUp($: Eng, st: State): Promise<boolean> {
  let moved = false
  for (const x of st.run!.queue.filter(y => y.status === 'cloud')) {
    if ((await $.process.run(['git', '-C', S.root, 'fetch', '-q', 'origin', `slice-${x.id}:slice-${x.id}`])).exitCode !== 0) continue
    Object.assign(x, { status: 'queued', why: `${x.why ?? ''}; built in the cloud, verify locally` })
    moved = true
    await logEvent($, 'cloud-back', { slice: x.id })
  }
  if (moved) await saveState($, st)
  return moved
}

export async function cloudStatus($: Eng): Promise<string> {
  if (!S.marker.cloud || !(await hasOrigin($))) return ''
  const refs = (await $.process.run(['git', '-C', S.root, 'ls-remote', 'origin', 'refs/slice/*-status'])).stdout.trim().split('\n').filter(Boolean)
  const out: string[] = []
  for (const line of refs) {
    const [sha, ref] = line.split('\t')
    if ((await $.process.run(['git', '-C', S.root, 'fetch', '-q', 'origin', ref!])).exitCode !== 0) continue
    const st = JSON.parse((await $.process.run(['git', '-C', S.root, 'show', `${sha}:state.json`])).stdout || '{}') as State
    const q = st.run?.queue ?? []
    const by = (s: string) => q.filter(x => x.status === s).map(x => x.id).join(', ') || '-'
    out.push(`cloud run ${st.run?.stage}: merged ${by('merged')} | waiting for you ${by('stuck')} | queued ${by('queued')}`)
  }
  return out.join('\n')
}
