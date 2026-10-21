---
name: research
description: Runs source-backed web research in which every claim carries a source and a confidence level. Scales depth to the question, from a short answer in chat to a notes file or a full HTML dossier, and resumes interrupted runs. Use when the user asks to research a topic on the web, compare sources or build a dossier. Not for debugging, searching the codebase or local files, looking up a library's API docs, or simple facts a single search answers.
when_to_use: Trigger phrases include "research X", "look into a topic", "dig into", "find out online", "compare X vs Y", "deep research", "dossier", and German "recherchiere", "Recherche zu", "recherchier mal", "finde heraus", "untersuche das Thema", "sammle Quellen zu", "Quellen vergleichen", "Marktüberblick", "Stand der Technik".
argument-hint: "<topic> [quick | deep | dossier]"
---

# Research

Goal: a result where every claim has a source and a confidence level. Depth follows the question; the process stays light for small questions and thorough for big ones.

Work in the current working directory. Bundled files: `${CLAUDE_SKILL_DIR}/references/sources.md` (confidence criteria, source preference), `${CLAUDE_SKILL_DIR}/references/browser.md` (browser use), `${CLAUDE_SKILL_DIR}/references/dossier.md` and `${CLAUDE_SKILL_DIR}/assets/dossier.html` (deep output).

## 0. Resume check

Before anything else: glob `research/*/notes.md` and match the `# <Topic>` heading against the current topic; if several match, take the newest folder. The same applies when the context was just compacted. Read `notes.md` and continue at the first sub-question that is `open` or `in progress`. If every sub-question is `answered` or `unanswered` but `Output:` is empty, go straight to step 5. No new folder; do not ask the user again and do not re-plan sub-questions.

## 1. Scope and depth

Ask nothing by default. Ask once (one `AskUserQuestion` call with structured options, or one short plain question if that tool is unavailable) only if the topic or the goal is genuinely unclear. Otherwise state the assumptions in one line, including the chosen depth, and start. Example: "Assuming you want current options for X, standard depth, results in research/2026-10-21-x/."

Pick the depth from the request. The user can force it with "quick", "deep" or "dossier" (dossier means deep).

| Depth | Fits | Sub-questions | Output |
| --- | --- | --- | --- |
| quick | one answerable question, at least two sources to cross-check | none or 1-2 | answer in chat with inline source links and confidence; no files |
| standard | a topic with several aspects | 3-5 | folder `research/<YYYY-MM-DD>-<slug>/` with `notes.md`; concise report in chat, or `report.md` if longer than about 40 lines |
| deep | decision-grade, contested or broad | 5-8 | `notes.md` plus a dossier |

The slug is short, lowercase, hyphenated.

## 2. Tools: escalation ladder

Use the lowest rung that works.

1. `WebSearch` to find candidates (several phrasings, in the topic's languages if useful).
2. `WebFetch` to read static pages.
3. A browser only when needed: JS-rendered content, bot protection, login, interaction. Read `${CLAUDE_SKILL_DIR}/references/browser.md` before the first browser step.

Quote only from text actually read: a fetch result or a browser snapshot of that exact page. Do not re-read a page you already read successfully. Escalating a failed fetch to the browser and re-snapshotting after waiting, scrolling or a banner are fine.

Prefer primary sources. Confidence criteria and source handling are in `${CLAUDE_SKILL_DIR}/references/sources.md`; read it before rating the first finding.

## 3. Notes

For standard and deep, create the folder and `notes.md`:

```markdown
# <Topic>
Depth: standard|deep · Start: <date time>
Output: (path or URL when done)

## Sub-questions
1. ... - status: open

## Findings
| # | Claim | Src | Quote | Confidence | Note |
|---|---|---|---|---|---|

## Sources
| Src | Title | Publisher | Date | URL |
|---|---|---|---|---|

## Contradictions
- ...

## Discarded sources
- URL - reason
```

Status per sub-question: `open`, `in progress`, `answered`, `unanswered`. Findings point to a source row by id (`s1`, `s2`, ...), so the dossier can be built without re-fetching. Write each finding to `notes.md` immediately and update the status at once. The file is the memory of the run and survives context compaction. Dates are absolute (`2026-10-21`, never "last week").

Quick runs keep the same discipline in the context but write no file.

## 4. Research loop

For each sub-question: set `in progress`, search, read the most promising sources, record findings with confidence.

Record contradictions in the Contradictions list. Do not resolve them silently; report both sides and carry the conflict into the open questions.

Stop on saturation, not on a fixed count. A sub-question is `answered` once backed at least at medium confidence. A round is one batch of searches plus reading the best hits. After two rounds without reaching medium, the sub-question is `unanswered`; keep the low-confidence findings as open questions. The run ends when every sub-question is `answered` or `unanswered`. "Not verified" is a valid answer.

### Parallel fan-out (standard and deep)

Independent sub-questions may run in parallel as subagents that use `WebSearch` and `WebFetch` only. Never give them the browser: there is one browser session, and it stays in the main context.

Subagents return text only; the main context writes `notes.md`. Brief each subagent with one sub-question and require this return format: a list of claims, each with claim, URL, source date, short verbatim quote, confidence. Synthesis, conflict resolution, confidence calls and the final text stay in the main context; re-rate what subagents return against `${CLAUDE_SKILL_DIR}/references/sources.md`, and treat a claim without a quote as unverified.

## 5. Output

Language: the user's conversation language. Quotes stay in their original language.

- **quick**: answer first, then inline links and a confidence note per claim. State what is unverified.
- **standard**: concise report in chat with sources and confidence; if it runs longer than about 40 lines, write `report.md` in the folder and summarize in chat.
- **deep**: build the dossier following `${CLAUDE_SKILL_DIR}/references/dossier.md` from `${CLAUDE_SKILL_DIR}/assets/dossier.html`. If an `Artifact` tool exists, load the `artifact-design` skill first if it exists, then publish; keep the HTML file under the research folder so a later session can update it by URL. Without an Artifact tool, write `dossier.html` into the folder and give the path. Record the link or path in `notes.md`.

## 6. Close

Close the browser if one was used. For quick, the answer is the close: add nothing. For standard without a file, add no extra summary. Otherwise give: the link or path, the three key findings in one sentence each, the open questions. Do not repeat the dossier in chat.
