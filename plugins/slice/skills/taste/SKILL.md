---
name: taste
description: Turns a UI task into screens that do not look machine-made, using structurally different HTML mockups the person picks from, locked design tokens, realistic seed data for every state and a check against known AI tells. Use when building or changing UI files in a repo set up with slice (.claude/slice.json), or when a feature needs screens before UI code exists.
when_to_use: Mockup, screen, layout, design, UI looks generic or AI-made, "sieht nach KI aus", "Oberfläche", "Bildschirm".
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.vue"
  - "**/*.svelte"
  - "**/*.css"
  - "**/*.html"
---
Active only when `.claude/slice.json` exists, otherwise ignore this skill. Taste belongs to the person; you carry it out against references. `DESIGN.md` belongs to the person too: tokens, references, named anti-patterns, target widths and a scroll allowlist, as the lines `widths: 360, 768, 1280` and `scroll-allow: .table-wrap, pre` that `ui-check` reads. Edits to it ask the person. If it does not exist, ask once; without an answer propose tokens and write them as a draft the person can change.

## Direction
Take the look from the subject's world, not from generic SaaS: paper and typesetting for a text editor, game material for game hosting. Name two real references and one anti-reference before drawing.

## Mockups first
Per screen family make 3 to 6 structurally different HTML mockups in one page with a switcher, each labelled with its trade-off. The person chooses; delete the others. Mockups are main-session work before `/slice:feature`; pass the chosen path in the brief. Keep the chosen one under `$(git rev-parse --path-format=absolute --git-common-dir)/slice/design/` with a screenshot per state and width. Do not depend on hosted design tools.

## States and data
Every UI slice covers all states at once: empty, loading, error, long data, and the ones the claim names. Seed realistic data for each (real names, lengths and edge cases), never "Lorem ipsum" or "Item 1".

## Tokens
Colors, spacing and type come only from the token file. With Tailwind v4 lock the palette with `@theme { --color-*: initial }` and use semantic props instead of free class names. If the repo has no lint rule against hard-coded colors outside the token file, suggest one; until then check with grep in the proof.

## Proof
Proofs run `node scripts/ui-check.mjs --url … --states '[…]'` (copied there by `/slice:setup`) from the repo's `verify-*` make target: widths and scroll allowlist from `DESIGN.md`, no horizontal overflow, no console errors, a screenshot per state. Compare screenshots with the mockup pairwise, per state. Coherence and distinctiveness weigh more than polish. Check the result against `${CLAUDE_SKILL_DIR}/references/tells.md` and remove the tells you find unless `DESIGN.md` allows them.

A visual regression baseline exists only after the person has accepted the look; then keep one screenshot per state and delete the rest.
