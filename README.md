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

None yet.

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest (list of plugins)
plugins/<name>/                   one plugin each, with its own .claude-plugin/plugin.json
.github/workflows/                CI (validate, version check) and releases
```

## License

MIT
