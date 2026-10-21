---
name: handover
description: Writes a handover file under temp/handover/ so the next session can continue without asking, with verified state and evidence, open items with owners, background work and what not to touch. Also resumes from the newest handover and re-checks it before acting. Works with or without git. Use when the user asks for a handover or to save state, when a session ends or the context runs long, or at session start to pick up earlier work.
when_to_use: Trigger phrases include "handover", "hand over", "write a handover", "save session state", "pick up where we left off", "continue the last session", "resume", and German "Übergabe", "Handover schreiben", "Stand sichern", "weitermachen, wo wir aufgehört haben", "letzte Session fortsetzen".
argument-hint: "[write | read] [topic]"
---

# Handover

The next session has nothing but this file and the environment. Everything it needs to continue goes in the file; anything it can look up itself goes in as a command, not as a transcript. A claim without evidence is a guess and is marked as one. A handover is state, not a diary: no order of events.

Write the content in the language the user is speaking. Headings and table headers stay in English as in the template; commands, paths and identifiers stay as they are. No emojis.

## Location and name

Define the base folder once and use it in every command:

```bash
BASE=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
```

- File: `$BASE/temp/handover/<YYYY-MM-DD-HHMM>-<slug>.md`.
- Newest file: `ls "$BASE"/temp/handover/*.md | sort | tail -1`.
- Each file carries `Continues from: <file>` or `Continues from: none`.
- Never edit `.gitignore` and never commit on your own.

## Choosing the mode

1. An explicit `write` or `read` argument wins.
2. The user asks to save or hand over: write.
3. Session start, a handover exists, and the user asks to continue: read.
4. Still ambiguous: ask once.
5. The context is running long but nobody asked: offer a handover, do not write it unasked.

## Mode: write

Write as soon as the session is long or a compaction is near; a handover from the very end is already incomplete.

1. Find the previous newest handover (command above) for the `Continues from` line.
2. Gather facts, adaptively, never from memory:
   - In a repo: `git status -sb` (includes ahead/behind), `git log --oneline -5`, `git worktree list`, `git stash list`, current branch.
   - `gh` or `glab` only if installed and a matching remote exists: open PRs or MRs and the issues that matter.
   - Without a repo, or on top of it: files changed this session, and the commands that prove the state (tests, build, lint).
   - For every worktree, agent or process named by memory or the task, confirm it exists (`test -d`, `git worktree list`, `ps`). If it does not, it is a pitfall with evidence, not background work.
3. Reconcile. When reality contradicts what the task, memory or an agent claims, reality wins: the proven state goes under "State, verified", the contradiction under "Pitfalls" with the evidence. Never adopt it silently, never drop it silently.
4. Pick the type and fill the template from `Template` below.
5. Check ignore status: in a repo run `git -C "$BASE" check-ignore -q temp/`; if it fails, `temp/` is not ignored.
6. Report the path of the file to the user, and say whether `temp/` is ignored.

| Type | When | Template changes |
| --- | --- | --- |
| in-progress | work continues next session | full template |
| closing | work is done, leftovers remain | "Open, in order" holds only the remaining items; "Background work" says `none` if there is none |
| knowledge | nothing to execute, only understanding to pass on | "Open, in order" says `none`; fill "Decisions this session" and "Pitfalls" in depth |

All template sections stay in every type. An empty section says `none`, so the reader knows it was considered.

Rules while writing:

- **Evidence on every status.** "Merged" carries the PR number and commit, "green" carries the command and the last output line, "running" carries paths or PIDs. What a subagent reported and nobody checked goes under "State, unverified".
- **No secrets, not even partial.** No token prefix, no masked value, no "it is in the env file on host X". The variable name is enough.
- **Background work is state.** Every running, stopped or crashed agent, worktree, process or monitor: where it lives, its condition, what to do with it. Uncommitted changes get one row each in "State, verified", not a subordinate clause.
- **"Do not touch" is its own section.** Branches or files that belong to the user, other people's PRs, resources in foreign systems, with the reason.
- **Owner and done-criterion on every open item.** Owner is `Agent` or `User`; the criterion is the observable evidence that tells the next session the item is finished.
- **Paths absolute or relative to the base folder.** Commits as seven-character SHAs. Commands in code blocks.
- **Stay under about 150 lines.** Overflow goes in a separate file next to the handover, which the handover links. Link an existing issue if there is one; never create one without asking.

## Mode: read

1. Find the newest file (command above). If there is none, say so and stop; invent nothing. Follow the `Continues from` chain backwards only if needed.
2. Check age and drift before acting. If the file is older than 3 days, or its branch or PRs moved on (new commits, merged, closed), say so first.
3. Verify every line under "State, verified" against reality (`git log`, `gh pr view`, `git worktree list`, rerun the proving command) before building on it. A handover ages from the moment it is written. If a line no longer holds, report the drift to the user and adjust "First steps" instead of running them blindly.
4. Respect "Do not touch" even when the situation looks different. When in doubt, ask the user.
5. Start with step 1 under "First steps", not with an analysis of your own.

## Template

```markdown
# Handover <YYYY-MM-DD> <topic>

Continues from: <file or none>
Type: in-progress | closing | knowledge
Base: <path> · Branch: <branch or n/a> (<whose work>) · Head: <commit or n/a>

## Task
<Goal in two sentences, who asked, ticket or epic if any.>

## State, verified
| What | State | Evidence |
| --- | --- | --- |

## State, unverified
<Agent reports, guesses, things only a run will show. Or: none>

## Background work
| Agent/process | Worktree, branch | Condition | What to do |
| --- | --- | --- | --- |

## Do not touch
<Branches, files, resources, with the reason. Or: none>

## Open, in order
| # | What | Owner | Done when |
| --- | --- | --- | --- |

## Decisions this session
<Decision, why, where it is recorded (doc, issue, memory). Or: none>

## Pitfalls
<What the next session would otherwise try again.>

## Gates and commands
<The commands that prove "green" here.>

## First steps
1. <concrete, with command>
2.
3.
```

## Rationalizations

| Excuse | Reality |
| --- | --- |
| "A summary of what happened makes the state clear" | The history is not the state. Use the evidence table; prose only for pitfalls. |
| "Naming just the token prefix is not a leak" | Name the variable. No value, no part, no pattern. |
| "The subagent said it is done" | Unverified until a command or the forge shows it. Mark it. |
| "The next session can see the worktrees itself" | It sees paths, not which agent left what half done. Only this file says. |
| "Do not touch goes without saying" | The next session finds a foreign branch checked out and tidies it up. Fill the section. |
| "I will write it at the very end" | By then the context the handover needs is gone. Write when the session gets long. |
| "The task says the worktree exists, so I will write that" | Check it. If it is not there, that is a pitfall with evidence. |
| "No git here, so there is nothing to verify" | Name the files touched and the command that proves the state. |

## Quick reference

```bash
BASE=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
ls "$BASE"/temp/handover/*.md | sort | tail -1            # newest handover
grep -n "unverified" "$BASE"/temp/handover/*.md           # what still needs checking
git -C "$BASE" check-ignore -q temp/ || echo "temp/ is not ignored"   # tell the user, do not edit .gitignore
```
