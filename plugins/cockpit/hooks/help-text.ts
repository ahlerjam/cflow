// Content of the Help tab: kept here so the pane and the AI help read the same text.
import type { Locale } from './i18n'
import { S } from './state'

export type HelpCommand = { cmd: string; what: string; fill: string }

export type HelpSection = { id: string; title: string; color: string; lines: readonly string[] }

// Tapping puts `fill` in the input line; Enter runs it. A `fill` ending in a space still needs a value.
export const HELP_COMMANDS: Record<Locale, readonly HelpCommand[]> = {
  en: [
    { cmd: '/cockpit', what: 'Opens the pane; if it is closed, the "◧ Open Cockpit" button above the prompt does the same', fill: '/cockpit' },
    { cmd: '/cockpit <tab>', what: 'Opens the pane on a tab: sources, actions, issues, settings, help', fill: '/cockpit ' },
    { cmd: ';name', what: 'Loads a source until the session ends; Tab completes', fill: ';' },
  ],
  de: [
    { cmd: '/cockpit', what: 'Öffnet die Pane; ist sie zu, tut das auch der Knopf „◧ Cockpit öffnen“ über dem Prompt', fill: '/cockpit' },
    { cmd: '/cockpit <tab>', what: 'Öffnet die Pane mit einem Tab: sources, actions, issues, settings, help (auch die deutschen Namen quellen, einstellungen, anleitung)', fill: '/cockpit ' },
    { cmd: ';name', what: 'Lädt eine Quelle bis Sessionende nach; Tab ergänzt', fill: ';' },
  ],
}

export const HELP_SECTIONS: Record<Locale, readonly HelpSection[]> = {
  en: [
    {
      id: 'sources',
      title: 'Sources: on · off · never',
      color: 'suggestion',
      lines: [
        'Every skill, plugin, MCP server and custom agent has a saved default. It applies globally; a folder can deviate from it (see below).',
        '- **Global or this folder:** switch at the top of the overview. "Global" sets the default everywhere. "This folder" sets a deviation only for the session\'s git repo (outside a repo: the start folder); dimmed buttons show the global state, `↺` removes the deviation. In the "Global" view a deviation appears as "here on/off/never" after the name. Everything is saved in `cockpit.json` under `folders`, nothing in the repo.',
        '- **on:** visible as usual.',
        '- **off:** hidden. Claude only sees the name; the source loads on its first call without asking and shows a short notice.',
        '- **never:** never loaded. A call is refused, and the refusal names the better way (the hint lives in `cockpit.json` under `hints`). Mentioning it in the prompt or a Bash detour does not change that.',
        '- **Newly listed:** sources without an entry follow "New sources" under Settings (default: on). Plugins enabled only in a repo (marked "Repo") are set to "on".',
        '- **Skills, MCP servers, agents:** one row each with `on`, `off`, `never`. A click saves at once to `~/.claude/cockpit/cockpit.json`.',
        '- **Plugins:** `▸` expands the children, the plugin\'s skills and MCP servers. They inherit the plugin\'s state (button dimmed, "(plugin)"); a click of their own sets their own state, `↺` removes it again. Plugin agents only hang off the plugin.',
        '- **Which sources exist:** per session and folder. Cockpit scans at start, twice more shortly after, and on every turn (at most every 30 s); late-connecting MCP servers join as soon as the engine describes their tools. If part of the scan fails, the old state stays. By hand: Settings → "Rescan sources".',
        '- **Manage plugins:** all global plugins and those of this folder. Enabling, disabling and deleting reload afterwards. Repo-scope plugins live in the checked-in `.claude/settings.json`; Cockpit asks first there.',
      ],
    },
    {
      id: 'reload',
      title: 'Loading on request and keeping on',
      color: 'remember',
      lines: [
        'What is set to "off" comes back when Claude calls it or you name it. It stays available until the session ends and appears in the "Loaded (this session)" frame with a counter.',
        '- **Call:** When Claude calls a hidden skill, MCP tool or agent, Cockpit loads it and lets the call through. An MCP server loads as a whole, a plugin skill on its own.',
        '- **;name:** `;github` in the prompt loads every source whose name or name part starts that way. Tab after `;git` suggests matching sources, switched-off ones first.',
        '- **Naming it:** A distinctive name as a whole word is enough, such as "with the humanizer". General words like "plugin" or "server" do not count.',
        '- **/command:** Cockpit never hides slash commands. If you type `/humanizer-de:humanizer-de`, the plugin loads.',
        '- **keep on:** sets the source to "on" and saves it. **undo:** removes the grant, the saved state applies again.',
        '- **Detours:** A Bash command that hits a known rule (say `curl` on a page for which an MCP server is installed) is stopped; Cockpit loads the first matching source that is not set to "never", and Claude uses it instead. The rules live under `redirects` in `cockpit.json`.',
        '- A plugin disabled in `enabledPlugins` cannot be loaded, because Claude Code does not know it at all. Turn it on under Sources → Manage plugins.',
      ],
    },
    {
      id: 'limits',
      title: 'What "hidden" means',
      color: 'inactive',
      lines: [
        '- Skills appear in the skill list by name only, in a "loads on call" line (not at all for "never"). Agents set to "off" stay callable; only "never" is not offered. LSP diagnostics are dropped while no LSP plugin is on.',
        '- MCP tools are deferred: their name stays visible, their schema does not. The first call loads the server.',
        '- The MCP instructions of hidden servers are missing from the system prompt; the count is shown below.',
        '- Everything stays loaded: MCP and LSP servers keep running, and so do plugin hooks. Only "Disable" under Sources → Manage plugins really unloads.',
        '- What is already in the conversation stays there until `/compact` or a new session.',
        '- Non-interactive runs (`claude -p`, worktree agents) are never filtered by Cockpit.',
      ],
    },
    {
      id: 'actions',
      title: 'Actions',
      color: 'autoAccept',
      lines: [
        '- **Runs:** the last 50 of this repo or of all repos ("All repos"). A run shows jobs and steps, "View log" loads the log, "Errors only" filters.',
        '- **In a run:** "Rerun failed", "Rerun all", "Cancel". "→ Claude" hands the run or log to Claude for analysis, "↗ Browser" opens GitHub.',
        '- **Runners:** utilization and status on top, below it "Pool /health" (refreshed every minute, with an assessment) and the VM list.',
        '- **Workflows:** the name filters the runs, "Start" triggers `workflow_dispatch`.',
      ],
    },
    {
      id: 'issues',
      title: 'Issues',
      color: 'warning',
      lines: [
        '- Open issues of the repo with AI summary, labels, epic, blockers and PRs. Search and "Mine only" filter.',
        '- The title opens the issue here, "↗ Browser" opens it on GitHub, "→ Claude" puts a reference to it into the input, where you add what Claude should do.',
      ],
    },
    {
      id: 'files',
      title: 'Settings and file',
      color: 'subtle',
      lines: [
        '- **Settings:** open on start, notices, "New sources" (on or off for sources without an entry), language (Auto follows the `language` setting of Claude Code, then the environment; the text Claude sees stays English), polling interval for Actions and Issues, and the startup texts Cockpit suppresses while their plugin is not on.',
        '- Everything lives in `~/.claude/cockpit/cockpit.json`. Every change reads the file fresh so two sessions do not overwrite each other. If it is broken, Cockpit saves nothing until it is repaired and reloaded.',
        '- A file in the old format 2 is upgraded to format 3 at start (the German an/aus/nie become on/off/never, sources without an entry stay "off"); the original is kept next to it as `cockpit.json.bak-v2`.',
        '- The status line at the bottom shows how many sources are on, how many were loaded, and the CI state.',
      ],
    },
  ],
  de: [
    {
      id: 'sources',
      title: 'Quellen: an · aus · nie',
      color: 'suggestion',
      lines: [
        'Jeder Skill, jedes Plugin, jeder MCP-Server und jeder eigene Agent hat einen gespeicherten Standard. Er gilt global; pro Ordner lässt sich davon abweichen (siehe unten).',
        '- **Global oder dieser Ordner:** oben in der Übersicht umschalten. „Global“ setzt den Standard überall. „Dieser Ordner“ setzt eine Abweichung nur für das Git-Repo der Session (außerhalb eines Repos: den Startordner); gedimmte Knöpfe zeigen den globalen Stand, `↺` löscht die Abweichung. In der Ansicht „Global“ steht eine Abweichung als „hier an/aus/nie“ hinter dem Namen. Gespeichert wird alles in `cockpit.json` unter `folders`, nichts im Repo.',
        '- **an:** sichtbar wie gewohnt.',
        '- **aus:** ausgeblendet. Claude sieht nur den Namen; die Quelle lädt beim ersten Aufruf ohne Rückfrage nach und meldet das kurz.',
        '- **nie:** wird nie geladen. Ein Aufruf wird abgelehnt, die Ablehnung nennt den besseren Weg (der Hinweis steht in `cockpit.json` unter `hints`). Auch Nennen im Prompt oder ein Bash-Umweg ändern das nicht.',
        '- **Neu angezeigt:** Quellen ohne Eintrag richten sich nach „Neue Quellen“ unter Einstellungen (Standard: an). Plugins, die nur in einem Repo aktiviert sind (Marke „Repo“), stehen auf „an“.',
        '- **Skills, MCP-Server, Agenten:** je eine Zeile mit `an`, `aus`, `nie`. Ein Klick speichert sofort in `~/.claude/cockpit/cockpit.json`.',
        '- **Plugins:** `▸` klappt die Kinder auf, Skills und MCP-Server des Plugins. Sie erben den Zustand des Plugins (Knopf gedimmt, „(Plugin)“); ein eigener Klick setzt einen eigenen Zustand, `↺` löscht ihn wieder. Plugin-Agenten hängen nur am Plugin.',
        '- **Welche Quellen es gibt:** pro Session und Ordner. Das Cockpit sucht beim Start, kurz danach noch zweimal und bei jedem Turn (höchstens alle 30 s) nach; spät verbundene MCP-Server kommen dazu, sobald die Engine ihre Tools beschreibt. Schlägt ein Teil der Suche fehl, bleibt der alte Stand stehen. Von Hand: Einstellungen → „Quellen neu suchen“.',
        '- **Plugins verwalten:** alle globalen Plugins und die dieses Ordners. Aktivieren, Deaktivieren und Löschen laden danach neu. Plugins im Repo-Scope stehen in der eingecheckten `.claude/settings.json`; dort fragt das Cockpit erst nach.',
      ],
    },
    {
      id: 'reload',
      title: 'Nachladen und dauerhaft an',
      color: 'remember',
      lines: [
        'Was auf „aus“ steht, kommt zurück, sobald Claude es aufruft oder du es nennst. Es bleibt bis Sessionende verfügbar und steht im Rahmen „Nachgeladen (diese Session)“ mit Zähler.',
        '- **Aufruf:** Ruft Claude einen ausgeblendeten Skill, ein MCP-Tool oder einen Agenten auf, lädt das Cockpit ihn nach und lässt den Aufruf durch. Ein MCP-Server lädt komplett, ein Plugin-Skill einzeln.',
        '- **;name:** `;github` im Prompt lädt jede Quelle nach, deren Name oder Namensteil so beginnt. Tab nach `;git` schlägt passende Quellen vor, ausgeschaltete zuerst.',
        '- **Beim Namen nennen:** Ein markanter Name als ganzes Wort reicht, etwa „mit dem Humanizer“. Allgemeine Wörter wie „plugin“ oder „server“ zählen nicht.',
        '- **/befehl:** Slash-Befehle blendet das Cockpit nie aus. Tippst du `/humanizer-de:humanizer-de`, lädt das Plugin nach.',
        '- **dauerhaft an:** setzt die Quelle auf „an“ und speichert sie. **zurücknehmen:** entfernt die Freigabe, es gilt wieder der gespeicherte Zustand.',
        '- **Umwege:** Ein Bash-Befehl, der eine bekannte Regel trifft (etwa `curl` auf eine Seite, für die ein MCP-Server installiert ist), wird gestoppt; das Cockpit lädt die erste passende Quelle, die nicht auf „nie“ steht, und Claude nimmt sie stattdessen. Die Regeln stehen unter `redirects` in `cockpit.json`.',
        '- Nicht nachladen lässt sich, was in `enabledPlugins` wirklich aus ist: Das kennt Claude Code gar nicht. Einschalten unter Quellen → Plugins verwalten.',
      ],
    },
    {
      id: 'limits',
      title: 'Was „ausgeblendet“ heißt',
      color: 'inactive',
      lines: [
        '- Skills stehen in der Skill-Liste nur mit Namen in einer Zeile „lädt beim Aufruf“ (bei „nie“ gar nicht). Agenten auf „aus“ bleiben aufrufbar, nur „nie“ wird nicht angeboten. LSP-Diagnosen werden verworfen, solange kein LSP-Plugin an ist.',
        '- MCP-Tools werden zurückgestellt: Ihr Name bleibt sichtbar, ihr Schema nicht. Der erste Aufruf lädt den Server nach.',
        '- Die MCP-Anweisungen ausgeblendeter Server fehlen im System-Prompt; unten steht, wie viele.',
        '- Geladen bleibt alles: MCP- und LSP-Server laufen weiter, Plugin-Hooks auch. Wirklich entladen geht nur mit „Deaktivieren“ unter Quellen → Plugins verwalten.',
        '- Was schon im Gespräch steht, bleibt dort bis `/compact` oder zur neuen Session.',
        '- Nicht-interaktive Läufe (`claude -p`, Worktree-Agenten) filtert das Cockpit nie.',
      ],
    },
    {
      id: 'actions',
      title: 'Actions',
      color: 'autoAccept',
      lines: [
        '- **Läufe:** die letzten 50 dieses Repos oder aller Repos („Alle Repos“). Ein Lauf zeigt Jobs und Schritte, „Log ansehen“ lädt das Log, „Nur Fehler“ filtert.',
        '- **Im Lauf:** „Fehlgeschlagene neu“, „Alles neu“, „Abbrechen“. „→ Claude“ gibt Lauf oder Log zur Analyse an Claude, „↗ Browser“ öffnet GitHub.',
        '- **Runner:** oben Auslastung und Stand, darunter „Pool /health“ (jede Minute neu, mit Bewertung) und die VM-Liste.',
        '- **Workflows:** Der Name filtert die Läufe, „Starten“ löst `workflow_dispatch` aus.',
      ],
    },
    {
      id: 'issues',
      title: 'Issues',
      color: 'warning',
      lines: [
        '- Offene Issues des Repos mit KI-Zusammenfassung, Labels, Epic, Blockaden und PRs. Suche und „Nur meine“ filtern.',
        '- Der Titel öffnet das Issue hier, „↗ Browser“ auf GitHub, „→ Claude“ setzt einen Verweis darauf in die Eingabe; dort ergänzt du, was Claude tun soll.',
      ],
    },
    {
      id: 'files',
      title: 'Einstellungen und Datei',
      color: 'subtle',
      lines: [
        '- **Einstellungen:** Beim Start öffnen, Hinweise, „Neue Quellen“ (an oder aus für Quellen ohne Eintrag), Sprache (Auto folgt der Einstellung `language` von Claude Code, dann der Umgebung; der Text, den Claude sieht, bleibt Englisch), Takt für Actions und Issues, Startup-Texte, die das Cockpit unterdrückt, solange ihr Plugin nicht an ist.',
        '- Alles steht in `~/.claude/cockpit/cockpit.json`. Jede Änderung liest die Datei frisch, damit zwei Sessions sich nicht überschreiben. Ist sie kaputt, speichert das Cockpit nichts, bis sie repariert und neu geladen ist.',
        '- Eine Datei im alten Format 2 hebt das Cockpit beim Start auf Format 3 (an/aus/nie werden on/off/never, Quellen ohne Eintrag bleiben „aus“); das Original liegt danach als `cockpit.json.bak-v2` daneben.',
        '- Die Statuszeile unten zeigt, wie viele Quellen an sind, wie viele nachgeladen wurden, und den CI-Stand.',
      ],
    },
  ],
}

export const helpCommands = (locale: Locale = S.locale): readonly HelpCommand[] => HELP_COMMANDS[locale]

export const helpSections = (locale: Locale = S.locale): readonly HelpSection[] => HELP_SECTIONS[locale]

// The whole guide as text for the AI help, in the active locale
export function helpAsText(locale: Locale = S.locale): string {
  const cmds = helpCommands(locale).map(c => `- ${c.cmd}: ${c.what}`).join('\n')
  const secs = helpSections(locale).map(s => `## ${s.title}\n${s.lines.join('\n')}`).join('\n\n')
  return `# Cockpit guide\n\n## Commands\n${cmds}\n\n${secs}`
}

export const HELP_SYSTEM = [
  'You answer questions about Cockpit, a mod for Claude Code. The only source is the guide below.',
  'Answer in the language of the question, briefly and concretely, in at most 6 sentences or bullets. Put matching commands in backticks.',
  'If the guide does not cover something, say so openly instead of guessing.',
].join('\n')
