# cflow

Meine persönliche Sammlung von Claude-Code-Plugins: die Skills, Agenten und
Workflows, mit denen ich arbeite. Jedes Plugin ist einzeln installierbar.

```
/plugin marketplace add ahlerjam/cflow
/plugin install <plugin>@cflow
```

## Plugins

Noch keine.

## Aufbau

```
.claude-plugin/marketplace.json   Marketplace-Manifest (Liste der Plugins)
plugins/<name>/                   je ein Plugin mit eigenem .claude-plugin/plugin.json
```

Ein neues Plugin bekommt einen Ordner unter `plugins/` und einen Eintrag in
`.claude-plugin/marketplace.json`.

## Lizenz

MIT
