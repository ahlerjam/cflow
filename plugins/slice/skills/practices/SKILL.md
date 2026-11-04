---
name: practices
description: Engineering know-how for planning and building with slice. Rules and sources for writing good work items and E2E steps, per-project-type cookbooks (CLI, web UI, HTTP API, library, data job) with coverage questions, quality bar and E2E approach, code rules against AI slop, and architecture records (ADR, vertical slices, walking skeleton). Use when the shape skill plans work or a slice run session builds it.
when_to_use: /slice:shape, slice run session, .slice/plans, slice cookbook.
user-invocable: false
---
Load only the files the task needs. Each file states rules first and its sources last; follow the rules, look up the
sources or current library docs (Context7) only when a rule does not settle a question. Run sessions have no web
access: there, use only Context7 or the installed package's docs.

| File | Load when |
|---|---|
| `${CLAUDE_SKILL_DIR}/references/issues.md` | Planning: writing the spec, features and E2E steps |
| `${CLAUDE_SKILL_DIR}/references/cli.md` | The work is a command line tool |
| `${CLAUDE_SKILL_DIR}/references/web.md` | The work has screens in a browser |
| `${CLAUDE_SKILL_DIR}/references/api.md` | The work is or exposes an HTTP API |
| `${CLAUDE_SKILL_DIR}/references/library.md` | The work is a library or SDK other code imports |
| `${CLAUDE_SKILL_DIR}/references/data-job.md` | The work is a batch, import, sync or ETL job |
| `${CLAUDE_SKILL_DIR}/references/code.md` | Writing or reviewing code (every run session) |
| `${CLAUDE_SKILL_DIR}/references/architecture.md` | A new app, a structural choice, or a decision worth recording |

Several types can apply (a web app with an API): load each. The repo's own conventions (`CLAUDE.md`, existing code,
formatter and linter config) win over these files.
