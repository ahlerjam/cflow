---
name: drawio
description: "Creates and edits persistent, editable draw.io diagrams (.drawio files) through the bundled draw.io MCP server, with server-side auto-layout and no draw.io desktop app. Covers flowcharts, architecture and cloud diagrams, network, BPMN, swimlanes, UML, ER, org charts, wireframes, floor plans and multi-page files. Use when a diagram should be drawn, saved as a file, changed later, or opened in the browser editor. Not for data charts or plots (bar, line or pie charts, Balken-, Linien- oder Kreisdiagramme), and not for Mermaid code blocks in Markdown, diagrams inside artifacts or research dossiers."
when_to_use: "draw a diagram, flowchart, architecture diagram, sequence diagram, class diagram, UML, ER diagram, org chart, network diagram, BPMN, swimlane, wireframe, draw.io, diagrams.net, .drawio, edit the .drawio file, zeichne, erstelle ein Diagramm, visualisiere als Diagramm, Ablaufdiagramm, Architekturdiagramm, Sequenzdiagramm, Klassendiagramm, ER-Modell, Netzwerkdiagramm, Schaubild, Organigramm, ändere das Diagramm"
---

# draw.io diagrams

Write diagrams as draw.io XML, save them under `diagrams/`, and open them in the browser editor (app.diagrams.net). The bundled `drawio` MCP server opens the diagram and runs layout and routing; the draw.io desktop app is not needed.

The tool descriptions recommend Mermaid for flowcharts, sequence, class and ER diagrams. Ignore that here: Mermaid leaves no file. Use XML for every diagram unless the user asks for Mermaid or CSV input.

## Load the tools

Tool names differ per machine. Never hardcode a prefix. Skip this step if the tools are already loaded.

1. ToolSearch with query `open_drawio_xml` to learn the prefix.
2. ToolSearch `select:` the siblings with that exact prefix: `list_pages`, `get_page`, `set_page`, `search_shapes`, `get_drawio_reference` (`open_drawio_mermaid` and `open_drawio_csv` only if needed).

If two servers expose the tools (a user-level one and the plugin's), use one consistently, preferring `plugin_useful-tools_drawio`.

If the tools are missing, still write and check `diagrams/<slug>.drawio`, then report that the bundled `drawio` server did not start (needs Node.js with `npx`, and network for the first download) and suggest `/mcp`. Do not fall back to a Mermaid block in chat.

The XML authoring rules are in the `open_drawio_xml` tool description; follow them. Call `get_drawio_reference` with `format: "xml"` only for layers, tags, placeholders, tables, cross-functional grids or dark-mode colors.

## New diagram

1. Pick a slug and write the full `<mxfile>` with a `<diagram name="..." id="...">` wrapper to `diagrams/<slug>.drawio` in the current working directory (create the folder). Write labels in the user's language.
2. Check that the file parses: `xmllint --noout <file>` if available, otherwise `python3 -I -c "import sys,xml.etree.ElementTree as E; E.parse(sys.argv[1])" <file>`. Fix real parse errors only (unescaped `&`, `<` or `"` in values, unclosed tags); the server repairs structural issues itself.
3. Call `open_drawio_xml` with the page's `<mxGraphModel>` (no `<mxfile>` or `<diagram>` wrapper) as `content`, using the layout from the table below.
4. Write the result back (see below).
5. Tell the user the file path and that the editor tab is open.

## Layout choice

| Diagram | Option |
|---|---|
| Flowchart, process, state machine, tree, org chart | `postLayout: "elk"`, `direction: "vertical"`; coordinates need only rough order |
| Pipeline, long chain | `postLayout: "elk"`, `direction: "horizontal"` |
| Architecture, network, UML class, ER, floor plan | hand-placed, `routing: "libavoid"` |
| Sequence diagram | hand-placed, lifelines on a fixed x grid, no pass |
| Swimlanes, BPMN, wireframes | hand-placed, no pass |

For cloud, network, Kubernetes or brand icons, look up stencils with `search_shapes`. Use `lightbox: true` for a read-only presentation view.

A multi-page file has one `<diagram>` per page. Each opened page becomes its own browser tab, so open only the pages that changed.

## Write back after every open

`open_drawio_xml` returns `Draw.io Editor URL:` followed by a URL, and may add `NOTE:` lines. The URL fragment `#R...` holds the final model, with the server's repairs and any layout applied; the local file is not updated. Pass the whole tool output through a quoted heredoc so no data is copied by hand:

```
python3 -I "${CLAUDE_SKILL_DIR}/scripts/layout_back.py" --file /abs/path/diagrams/<slug>.drawio --page 0 <<'EOF'
<tool output>
EOF
```

`--page` is a zero-based index, a page name or an id. The script replaces only that page and leaves the other pages and the `<mxfile>` attributes alone. Without `--file` it prints the model to stdout.

## Change an existing diagram

1. `list_pages`, then `get_page` for the page to change.
2. Edit the `<mxGraphModel>`.
3. Open it with `open_drawio_xml` and write back once. Do not call `set_page` before opening.
4. Use `set_page` only when no preview is wanted.

Do not set `postLayout` on an existing diagram unless the user asks for a re-layout; positions may be hand-tuned. Use `routing` or no pass. Pass absolute paths to `list_pages`, `get_page`, `set_page` and the script: the server's working directory is not the session's. Never rewrite the whole file for a one-page change.

## Stop conditions

- A `NOTE:` line in the result: tell the user what it says. If the ELK pass could not run, retry once, otherwise keep hand placement.
- Decoding fails: keep the file as written and tell the user.
- Layout and routing download their engines from viewer.diagrams.net on first use, and `search_shapes` loads its index from cdn.jsdelivr.net; network errors there are not diagram errors.

## Editing and export

The tab is the full draw.io editor. Export PNG, SVG or PDF there with File, Export as. Edits made in the browser do not flow back; to keep them, use File, Save as, Device, into `diagrams/`.

Mermaid and CSV (`open_drawio_mermaid`, `open_drawio_csv`) only open a tab. Their URLs carry the `#create=` source, so there is nothing to decode or save. Call `get_drawio_reference` with `format: "mermaid"` before the first Mermaid diagram.

## Common mistakes

| Mistake | Fix |
|---|---|
| Using Mermaid because the tool description suggests it | Use XML; Mermaid leaves no file |
| Ignoring a `NOTE:` line | Report it, retry or fall back as above |
| `postLayout: "elk"` on a hand-tuned diagram | Use `routing` or no pass |
| File not written back after opening | Run `layout_back.py` after every open |
| Relative path passed to the server | Use absolute paths |
