#!/usr/bin/env node
// PostToolUse in run sessions: hands new lines of the plan's inbox.md to the builder as context, each once.
// The count of lines already shown lives outside the repo, since the builder may not write into .git.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const plan = process.env.SLICE_PLAN
if (process.env.SLICE_RUN !== '1' || !plan) process.exit(0)
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const inbox = join(root, '.slice/plans', plan, 'inbox.md')
let lines
try {
  lines = readFileSync(inbox, 'utf8').split('\n').filter(l => l !== '')
} catch {
  process.exit(0)
}
const seenFile = join(tmpdir(), `slice-inbox-${createHash('sha1').update(inbox).digest('hex').slice(0, 12)}`)
let seen = 0
try {
  seen = Number(readFileSync(seenFile, 'utf8')) || 0
} catch {}
if (lines.length <= seen) process.exit(0)
writeFileSync(seenFile, String(lines.length))
const text = `New message from the person for this run (from ${inbox}):\n${lines.slice(seen).join('\n')}\n`
  + 'Handle it now as the Messages section of the slice skill says, and answer under "## Replies" in progress.md.'
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }))
