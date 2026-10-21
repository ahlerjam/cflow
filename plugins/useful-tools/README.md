# useful-tools

Session tools: handover files that let the next session pick up the work, and source-backed web research from quick answers to full dossiers.

## Install

```
/plugin install useful-tools@cflow
```

## Usage

Its own two skills trigger from natural language or run as slash commands. Two writing editors come along as dependencies.

**handover** (`/useful-tools:handover`) writes a state file to `temp/handover/<date>-<time>-<slug>.md` so the next session can continue without you: verified status with evidence, unverified claims, background work, things not to touch, open items with owner and done-criterion, first steps. It works with or without git. Say "handover", "save session state" or "Übergabe" to write one; at session start say "continue the last session" to read the newest one and verify it before acting.

**research** (`/useful-tools:research`) runs web research where every claim has a source and a confidence level. Depth follows the question, or force it with a keyword:

- quick: a few sources, answer in chat with links.
- standard: concise report in chat with a sources list.
- deep (or "dossier"): a dossier published as an artifact.

Research writes no files; the only file is the HTML behind an artifact, in the scratchpad or temp directory.

Try "research X", "look into a topic", "recherchiere X" or "compare X vs Y deep".

**humanizer** and **humanizer-de** are third-party plugins, installed as dependencies: [blader/humanizer](https://github.com/blader/humanizer) rewrites AI-sounding English text, [marmbiz/humanizer-de](https://github.com/marmbiz/humanizer-de) does the same for German. They are listed in cflow straight from their authors' repos and follow their latest versions. See their READMEs for usage.

## Setup

- All dependencies install with `useful-tools`, nothing to add by hand.
- The official `playwright` plugin from `claude-plugins-official` is one of them. research uses it only for pages that need JavaScript, a login or get blocked. It needs Node.js (`npx`) and opens a visible browser window by default.
- Deep dossiers are published as an artifact when the Artifact tool is available, otherwise delivered in chat as structured markdown.
- Add `temp/` to `.gitignore`. The skills never edit it for you.
