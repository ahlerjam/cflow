# cflow

My personal collection of Claude Code plugins: the skills, agents and
workflows I work with. Each plugin can be installed on its own.

```
/plugin marketplace add ahlerjam/cflow
/plugin install <plugin>@cflow
```

## Plugins

None yet.

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest (list of plugins)
plugins/<name>/                   one plugin each, with its own .claude-plugin/plugin.json
```

A new plugin gets a folder under `plugins/` and an entry in
`.claude-plugin/marketplace.json`.

## License

MIT
