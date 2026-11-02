#!/usr/bin/env node
// PreToolUse guard for run sessions: .slice/features.json may change only in `passes`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

if (process.env.SLICE_RUN !== '1') process.exit(0)

const input = JSON.parse(readFileSync(0, 'utf8'))
const tool = input.tool_name
const args = input.tool_input || {}
const target = resolve(input.cwd || process.cwd(), '.slice/features.json')

const deny = reason => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }))
  process.exit(0)
}

const strip = text => {
  const data = JSON.parse(text)
  for (const f of data.features || []) delete f.passes
  return JSON.stringify(data)
}

if (tool === 'Bash') {
  const cmd = args.command || ''
  const writes = new RegExp('(>|\\btee\\b|\\bsed\\s+-i|\\b(mv|cp|rm|truncate|node|perl|ruby)\\b|\\bpython'
    + '|\\bgit\\s+(checkout|restore|reset))')
  if (/features\.json/.test(cmd) && writes.test(cmd)) {
    deny('Change .slice/features.json only with the Edit tool, and only the passes fields.')
  }
  process.exit(0)
}

if (resolve(input.cwd || process.cwd(), args.file_path || '') !== target) process.exit(0)

let current
try { current = readFileSync(target, 'utf8') } catch { process.exit(0) }

let next
if (tool === 'Write') next = args.content ?? ''
else if (tool === 'Edit') {
  if (!current.includes(args.old_string)) process.exit(0)
  next = args.replace_all
    ? current.split(args.old_string).join(args.new_string)
    : current.replace(args.old_string, () => args.new_string)
} else process.exit(0)

let same
try { same = strip(current) === strip(next) } catch { same = false }
if (!same) {
  deny('Only the passes fields of .slice/features.json may change in a run. '
    + 'Revert the other changes; write problems with a feature to .slice/progress.md.')
}
