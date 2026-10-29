# cflow

My personal collection of Claude Code plugins: the skills, agents and
workflows I work with. Each plugin can be installed on its own.

## Install

In a Claude Code session:

```
/plugin marketplace add ahlerjam/cflow
/plugin install <plugin>@cflow
```

## Stay up to date

Auto-update is off for third-party marketplaces by default. Turn it on once
per machine: `/plugin` → **Marketplaces** → **cflow** → **Enable auto-update**.

Without it, update by hand with `/plugin marketplace update cflow`.

Each plugin is versioned on its own. A new version ships as a
[release](https://github.com/ahlerjam/cflow/releases) tagged
`<plugin>--v<version>`, and its notes list what changed.

## Plugins

<!-- plugins:start -->
| Plugin | Version | Description |
| :- | :- | :- |
| [cockpit](plugins/cockpit) | 0.3.0 | Side pane next to the chat that switches every skill, plugin, MCP server and agent on, off or never, and shows GitHub Actions runs and issues of the current repo. |
| [humanizer](https://github.com/blader/humanizer) | upstream | Third-party, by blader: rewrites AI-sounding English text so it reads like the writer. Listed here as a dependency of useful-tools. |
| [humanizer-de](https://github.com/marmbiz/humanizer-de) | upstream | Third-party, by marmbiz: German style editor that finds and removes AI writing patterns. Listed here as a dependency of useful-tools. |
| [slice](plugins/slice) | 0.2.0 | Verification-first work loop for Claude Code, from a ticket to an unattended run: a mod runs the proof, a fresh verifier checks the claim, you accept. |
| [useful-tools](plugins/useful-tools) | 0.2.1 | Session tools: handover files for the next session, source-backed web research from quick answers to full dossiers, and editable draw.io diagrams without the desktop app. |
<!-- plugins:end -->

Each plugin has its own README with usage and setup.

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest (list of plugins)
plugins/<name>/                   one plugin each, with its own .claude-plugin/plugin.json
.github/workflows/                CI (validate, version check) and releases
```

## License

MIT
