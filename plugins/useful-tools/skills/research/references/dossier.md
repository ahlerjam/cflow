# Dossier structure (deep depth)

Template: `assets/dossier.html` in the skill folder (the full path is given in SKILL.md). Copy it to the session scratchpad directory if the system prompt names one, otherwise to the system temp directory, never into the working directory or a repo, and fill it from the findings tables and sources list in the conversation.

## Required skeleton

In this order, always present:

1. Header: title, date, source count.
2. Key answer: two to four sentences with the most important answer, footnoted.
3. Findings: one article per sub-question, one to three paragraphs, with a confidence badge. Unanswered sub-questions go to open questions instead.
4. Sources table: id `sN`, title as link, publisher, date, confidence.
5. Open questions: what could not be verified, contradictions, "not verified" items.
6. Footer: date and "Made with the research skill", translated like the labels.

## Optional blocks

Add a block only when the research fills it; delete the rest. Three to five blocks make a good dossier.

- Comparison table: for "A or B" questions. Every cell with a claim needs a footnote.
- Callout: a note, a warning, or an explicit "not verified" statement. At most two.
- Contradiction: a conditional block, required when two sources conflict. The conflict also goes into open questions.
- Recommendation: closes the findings, before the sources table, when the research leads to a recommendation. Omit for descriptive topics.
- Quote: a verbatim original-language quote, with `lang` set. Add a translation (`{{QUOTE_TRANSLATION}}`, optional) only where the meaning is not obvious.

Custom blocks are allowed when no block fits, built only from the template's CSS variables.

## Footnotes

Each claim carries `<sup><a href="#sN">N</a></sup>`. Every `N` must point to a source row `<tr id="sN">`. Number sources in order of first citation and reuse the number when a source is cited again. Suffix ids duplicated by repeated blocks (`note-2`).

## Language

Translate headings, labels and the footer text into the output language and set `<html lang>` accordingly (placeholder `{{LANG}}`, for example `en` or `de`). Quotes keep their original language.

## Placeholders

- `LANG`: output language code, for example `en`, `de`.
- `LABEL_*`, `HEADING_*`, `COL_*`: translated labels, headings and column titles.
- `QUOTE_LANG`: language code of the original quote.
- `LEVEL_*`: `high`, `medium` or `low`, used in the badge class; the visible badge text is the translated level.

## Diagrams

Use `<pre class="mermaid">` for flows and relations when text would be hard to follow. Do not load a mermaid library; Artifact pages render it natively. In a local file the block shows as plain text.

## Style limits

No new colors, fonts or external libraries beyond what the template loads. Wide content gets `class="wide"`. No screenshots unless the user asks.

## Final checks

Run both; fix until clean.

```bash
comm -23 <(grep -o 'href="#s[0-9]*"' dossier.html | sed 's/href="#//;s/"//' | sort -u) <(grep -o 'id="s[0-9]*"' dossier.html | sed 's/id="//;s/"//' | sort -u)
grep -n '{{' dossier.html
```

The first prints dangling footnotes, the second leftover placeholders; both must be empty. Delete the template's usage comment and any unused optional blocks.

## Publishing

With an `Artifact` tool: load `artifact-design` first if it exists, publish with a generic icon such as `search`, a one-sentence description, and the topic name as `<title>`. Publish early once the sub-questions are set, then republish the same file path as findings arrive. Without it: deliver the dossier content in chat as structured markdown, no file.
