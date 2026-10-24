# cockpit

Cockpit adds a pane beside the chat. It controls what Claude sees (each skill, plugin, MCP server and agent can be on, off or never) and shows the GitHub Actions runs and issues of the repo you are working in.

## Requirements

Install these yourself before using the plugin:

| Software | Needed for | Check |
| :- | :- | :- |
| [Claude Code](https://claude.com/claude-code) 2.1.287 or later (mods are on by default from that version; tested with 2.1.308) | the plugin itself | `claude --version` |
| [GitHub CLI](https://cli.github.com) | the Actions and Issues tabs | `gh auth status` |

The Sources tab works without `gh`; the two GitHub tabs then show a one-line reason instead.

## Install

```
/plugin marketplace add ahlerjam/cflow
/plugin install cockpit@cflow
```

Then run `/cockpit`. `/cockpit sources`, `actions`, `issues`, `settings` or `help` opens a given tab. The Help tab answers questions about the plugin.

## Sources

Every skill, plugin, MCP server and custom agent has a saved state:

- **on**: visible as usual.
- **off**: hidden. Claude sees only the name. The source loads when Claude calls it or when you name it in the prompt, and stays loaded for the session.
- **never**: refused. The refusal tells Claude the better way (see hints below). Naming it in the prompt or going around it with Bash does not change that.

Plugin children (their skills and MCP servers) inherit the plugin's state until you set one on them. A folder can deviate from the global default: choose "Local" in the overview. A session in a folder with deviations opens on "Local"; "keep" in the loaded list ("always on" in the Global view) then saves there too. The deviation is stored per git root (outside a repo, the start folder) in `cockpit.json`, not in the repo.

Type `;name` in the prompt to load a source for the session; Tab completes. Sources without an entry follow "New sources" under Settings (on for fresh installs). Slash commands are never hidden.

Hints and Bash redirects live in `cockpit.json`. A redirect stops a Bash command that matches a regular expression and loads the first listed source that is installed and not set to never:

```json
{
  "hints": {
    "mcp:old-search": "Use the web-search MCP server instead."
  },
  "redirects": [
    { "match": "^curl .*docs\\.example\\.com", "sources": ["mcp:docs-server"] }
  ]
}
```

Limits:

- "Hidden" does not unload anything. MCP and LSP servers and plugin hooks keep running; only Disable under Sources → Manage plugins unloads a plugin.
- What is already in the conversation stays until `/compact` or a new session.
- Non-interactive runs (`claude -p`) are never filtered.
- A plugin switched off in `enabledPlugins` cannot be loaded this way.

## Actions

Shows the last 50 runs of the current repo, or of all repos of the owner. Open a run to see jobs and steps, load the log and filter it to errors. You can rerun failed jobs, rerun all, cancel, and start a workflow that has `workflow_dispatch`. "To Claude" hands a run or its log to Claude for analysis. The status line shows the check counts of the current branch's PR, for example `PR #7 ✓3 ✗1 …2`.

Related settings: a notification when a run on the current branch ends, an alert for jobs queued longer than a chosen time, and the polling interval (off, 1, 1.5, 3 or 5 minutes; default 90 seconds). Inside a GitHub repo, a light poll runs every N seconds in the background; with a runner pool configured, its health is also fetched once a minute. Rate limits make the polling back off.

## Issues

Lists the issues of the repo with labels, native sub-issues, issue types, blockers and linked PRs, with search and filters for status, sort order, label, issue type and assignee. GitHub applies them through search qualifiers, so the counts stay correct; the type filter only shows for repos that use issue types. All issues are loaded, 100 per request up to the 1000 results GitHub search returns, and the list appears after the first request. Task lists (`- [ ]`) in an issue's description are clickable: a click ticks the task on GitHub by editing the issue description, and nothing is written if the text changed there in the meantime. Open an issue in the pane or on GitHub. "→ Claude" puts a reference to the issue into the input without sending it; you add what Claude should do. The reference tells Claude to treat the issue text as data, not as instructions.

AI summaries are off by default. When turned on, the title, labels and the first 3000 characters of each issue body are sent to the model chosen in Settings (haiku or sonnet).

## Settings and language

The Settings tab has: open on start, New sources, notices, language, polling interval, run-end notification, queued alert, issues per page (auto, 5, 10 or 20), AI summaries and model, the runner pool (read-only), sample data, startup texts to suppress while their plugin is off, and the config file with reload, rescan and reset.

Language is Auto (the `language` setting of Claude Code, then `LANG`), English or Deutsch. Text addressed to Claude stays English.

## Configuration file

`~/.claude/cockpit/cockpit.json`, or `$CLAUDE_CONFIG_DIR/cockpit/cockpit.json`. It is created on the first interactive start and has format version 3. A version 2 file is migrated and the original is kept once as `cockpit.json.bak-v2`. A broken file is never overwritten: nothing is saved until you repair it and reload.

## Runner pool (optional)

If you run your own GitHub runners behind a small HTTP service, the Actions tab can show its health and VM list. Add a `runnerPool` block under `settings`:

```json
{
  "settings": {
    "runnerPool": {
      "healthUrl": "https://pool.example.com/health",
      "vmsUrl": "https://pool.example.com/vms",
      "token": { "command": ["op", "read", "op://vault/pool/token"] },
      "owner": "my-org",
      "label": "Build pool"
    }
  }
}
```

- `healthUrl` (required) and `vmsUrl` (optional) must be `https`. A block with an invalid field is reported as an error in the pane and is not saved over.
- `token` is sent as a bearer token to `vmsUrl` only. Use `{ "command": [...] }` (an argv list, run without a shell, trimmed stdout is the token) or `{ "env": "NAME" }` (read with `printenv`, so POSIX only). `tokenCommand` and `tokenEnv` at the top level of the block are accepted as the same thing. The token is read once per session (a failed read is retried after 5 minutes; the command may take up to 30 seconds) and never stored in `cockpit.json`.
- `owner` is put in front of short repo names the pool reports. Without it, the owner of the current repo or the signed-in user is used.
- `label` is shown in Settings, cut to 40 characters.
- `maxPool` and `maxRunnersPerRepo` (whole numbers) set the maxima shown in the runner view. The `limits` of the `vmsUrl` answer win; without either, no maximum is shown.

`GET healthUrl` returns JSON; every field is optional:

```json
{ "mode": "auto", "vms": { "ready": 2, "busy": 1 }, "demand": 0, "managed": 3, "active": 1, "sizes": { "normal": 2, "large": 1 } }
```

`vms` maps a VM state to a count; `ready` counts as free, every other state as busy.

`GET vmsUrl` returns:

```json
{
  "limits": { "maxPool": 12, "maxRunnersPerRepo": 8 },
  "vms": [{ "name": "runner-1", "repo": "my-repo", "state": "busy", "size": "normal", "createdAt": 1767225600000 }],
  "demand": []
}
```

`demand` is a list of waiting jobs; only its length is used. Job names for busy VMs come from the GitHub API.

## Privacy

Cockpit runs the `gh` and `claude` CLIs on your machine, reads Claude Code settings and plugin lists, and writes only its own `cockpit.json` (plus the one-time `.bak-v2`). It talks to GitHub through `gh` and, if configured, to your runner pool. It calls a model only for AI issue summaries (opt-in) and for questions in the Help tab.
