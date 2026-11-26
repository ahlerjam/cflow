#!/usr/bin/env node
// Guard for run sessions: .slice/plans/$SLICE_PLAN/features.json may change only in `passes`.
// PreToolUse checks Edit/Write and Bash commands that name the file; PostToolUse (arg "post") compares the file
// with the `slice: plan <id>` commit after every Bash call, which also catches writes the command text does not show.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

// `gate <dir> <id>` is the binding check of the run control: exit 0 only when features.json in <dir> equals the
// latest `slice: plan <id>` commit besides passes. The hooks are early feedback; the PreToolUse hook is set to
// onFailure block, so a crash there denies the call instead of letting it through.
const strip = text => {
  const data = JSON.parse(text)
  for (const f of data.features || []) delete f.passes
  return JSON.stringify(data)
}
const sameBesidesPasses = (a, b) => {
  try { return strip(a) === strip(b) } catch { return false }
}
const planVersion = (root, id, rel) => {
  const git = a => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const subject = `slice: plan ${id}`
  const sha = git(['log', '--format=%H %s', '--fixed-strings', `--grep=${subject}`])
    .split('\n').find(l => l.slice(41) === subject)?.slice(0, 40)
  return sha ? git(['show', `${sha}:${rel}`]) : null
}

if (process.argv[2] === 'gate') {
  const [, , , dir, id] = process.argv
  const rel = `.slice/plans/${id}/features.json`
  let plan = null, current = null
  try { plan = planVersion(dir, id, rel); current = readFileSync(resolve(dir, rel), 'utf8') } catch {}
  if (plan === null || current === null) {
    console.log(`red: cannot compare ${rel} with its \`slice: plan ${id}\` commit`)
    process.exit(1)
  }
  if (!sameBesidesPasses(plan, current)) {
    console.log(`red: ${rel} changed beyond the passes fields`)
    process.exit(1)
  }
  console.log('ok')
  process.exit(0)
}

// The acceptance runs with the run profile (SLICE_RUN=1) but without SLICE_PLAN; it builds nothing, so it passes.
if (process.env.SLICE_RUN !== '1' || !process.env.SLICE_PLAN) process.exit(0)

const input = JSON.parse(readFileSync(0, 'utf8'))
const args = input.tool_input || {}
const cwd = input.cwd || process.cwd()
const root = process.env.CLAUDE_PROJECT_DIR || cwd
const rel = `.slice/plans/${process.env.SLICE_PLAN}/features.json`
const target = resolve(root, rel)
const post = process.argv[2] === 'post'

const answer = (obj) => {
  process.stdout.write(JSON.stringify(obj))
  process.exit(0)
}
const deny = reason => answer({
  hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
})

if (post) {
  let plan, current
  try {
    plan = planVersion(root, process.env.SLICE_PLAN, rel)
    if (plan === null) process.exit(0)
    current = readFileSync(target, 'utf8')
  } catch { process.exit(0) }
  if (!sameBesidesPasses(plan, current)) {
    answer({
      decision: 'block',
      reason: `${rel} changed beyond the passes fields. Restore it from the \`slice: plan\` commit `
        + `(git show <that commit>:${rel}) and set only passes again with the Edit tool.`,
    })
  }
  process.exit(0)
}

if (input.tool_name === 'Bash') {
  const cmd = args.command || ''
  if (!/features\.json/.test(cmd)) process.exit(0)
  const readOnly = /^\s*(cat|head|tail|less|grep|rg|jq|wc|diff|git\s+(diff|show|log|add|status|commit|blame))\b/
  const redirect = />\s*\S*features\.json/
  const bad = cmd.split(/&&|\|\||[;|\n]/).some(seg => /features\.json/.test(seg) && !readOnly.test(seg))
  if (bad || redirect.test(cmd)) {
    deny(`In a run, shell commands may only read ${rel}. Change its passes fields with the Edit tool.`)
  }
  process.exit(0)
}

if (resolve(cwd, args.file_path || '') !== target) process.exit(0)

let current
try { current = readFileSync(target, 'utf8') } catch { process.exit(0) }

let next
if (input.tool_name === 'Write') next = args.content ?? ''
else if (input.tool_name === 'Edit') {
  if (!args.old_string || !current.includes(args.old_string)) process.exit(0)
  next = args.replace_all
    ? current.split(args.old_string).join(args.new_string)
    : current.replace(args.old_string, () => args.new_string)
} else process.exit(0)

if (!sameBesidesPasses(current, next)) {
  deny(`Only the passes fields of ${rel} may change in a run. `
    + 'Revert the other changes; write problems with a feature to progress.md in the same folder.')
}
