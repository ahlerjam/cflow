---
name: taste
description: Judges and builds UI against four criteria (design quality, originality, craft, functionality) so screens do not look machine-made, using screenshots taken with the Playwright browser tools and a list of known AI tells. Use when building or changing UI in a repo set up with slice (.claude/slice.json), and for every feature with ui true in a run session.
when_to_use: 'Screen, layout, design, UI looks generic or AI-made, "sieht nach KI aus", "Oberfläche", "Bildschirm", features with ui true.'
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.css"
  - "**/*.html"
---
Active only when `.claude/slice.json` exists, otherwise ignore this skill. `DESIGN.md` belongs to the person (tokens, references, anti-patterns, and optional lines `widths: 360, 768, 1280` and `console-allow: <expected error text>`). Ask before editing it; if it is missing, propose tokens in your report.

## Criteria
Grade each screen on four criteria. Design quality and originality weigh more than craft and functionality.
- **Design quality**: the screen reads as one coherent whole: colors, type, spacing and layout share a mood and a hierarchy.
- **Originality**: choices come from the subject's world (paper and typesetting for an editor), not from a generic template. Name two real references and one anti-reference before you draw. Penalize the tells in `${CLAUDE_SKILL_DIR}/references/tells.md` and remove those you find.
- **Craft**: type hierarchy, spacing, contrast, consistent tokens (colors only from the token file).
- **Functionality**: a user finds the main action and completes it; every state works: empty, loading, error, long data, seeded with realistic data, never "Item 1".

## Evidence
With the Playwright browser tools, open every state at every width (default 360, 768, 1280; resize the window), take a screenshot each, and check that the page has no horizontal overflow (`document.documentElement.scrollWidth` equals the window width) and no console errors beyond `console-allow`. Look at the images and grade them; "it renders" is not a grade. Fix and re-shoot until nothing generic is left. In a run session decide alone; otherwise show the person the screenshots and let them choose between alternatives.
