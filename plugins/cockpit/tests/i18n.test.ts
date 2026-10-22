import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { DEFAULT_CONFIG } from '../hooks/defaults'
import { de, en, minutes, num, pickLocale, translate } from '../hooks/i18n'
import type { LocaleInput } from '../hooks/i18n'
import { S, normalizeTab } from '../hooks/state'

const pick = (over: Partial<LocaleInput> & { env?: LocaleInput['env'] } = {}) =>
  pickLocale({ setting: 'auto', claudeLanguage: undefined, env: {}, ...over })

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1] ?? '').sort()

describe('locale resolution', () => {
  test('Claude Code language setting decides first', () => {
    expect(pick({ claudeLanguage: 'german' })).toBe('de')
    expect(pick({ claudeLanguage: 'Deutsch' })).toBe('de')
    expect(pick({ claudeLanguage: 'de' })).toBe('de')
    expect(pick({ claudeLanguage: 'de-DE' })).toBe('de')
    expect(pick({ claudeLanguage: 'English' })).toBe('en')
    expect(pick({ claudeLanguage: 'french' })).toBe('en')
  })

  test('a Claude Code language beats the environment', () => {
    expect(pick({ claudeLanguage: 'English', env: { LANG: 'de_DE.UTF-8' } })).toBe('en')
  })

  test('empty language falls back to the environment', () => {
    expect(pick({ claudeLanguage: '', env: { LANG: 'de_DE.UTF-8' } })).toBe('de')
    expect(pick({ claudeLanguage: '  ', env: { LANG: 'en_US.UTF-8' } })).toBe('en')
    expect(pick({ claudeLanguage: 42, env: { LANG: 'de_AT' } })).toBe('de')
  })

  test('LC_ALL beats LC_MESSAGES beats LANG', () => {
    expect(pick({ env: { LC_ALL: 'en_US.UTF-8', LANG: 'de_DE.UTF-8' } })).toBe('en')
    expect(pick({ env: { LC_ALL: 'de_DE.UTF-8', LANG: 'en_US.UTF-8' } })).toBe('de')
    expect(pick({ env: { LC_ALL: '', LC_MESSAGES: 'de_DE', LANG: 'en_US' } })).toBe('de')
  })

  test('nothing set gives English', () => {
    expect(pick()).toBe('en')
    expect(pick({ env: { LANG: 'C' } })).toBe('en')
  })

  test('an explicit setting overrides auto', () => {
    expect(pick({ setting: 'en', claudeLanguage: 'german', env: { LANG: 'de_DE' } })).toBe('en')
    expect(pick({ setting: 'de', claudeLanguage: 'english', env: { LANG: 'en_US' } })).toBe('de')
  })
})

describe('catalog', () => {
  test('every English key exists in German and vice versa', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort())
  })

  test('both locales use the same placeholders', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect({ key, vars: placeholders(de[key]) }).toEqual({ key, vars: placeholders(en[key]) })
    }
  })

  test('translate fills placeholders and keeps unknown ones', () => {
    expect(translate('en', 'pane.tabError', { error: 'boom' })).toBe('This tab hit an error: boom')
    expect(translate('de', 'pane.tabError', { error: 'boom' })).toBe('Dieser Tab hat einen Fehler: boom')
    expect(translate('en', 'status.line', { on: 3, granted: 0, ci: '' })).toBe('Cockpit: 3 on · 0 loaded')
    expect(translate('en', 'pane.tabError', {})).toBe('This tab hit an error: {error}')
  })

  test('German writes a decimal comma', () => {
    expect(num(1.5, 'de')).toBe('1,5')
    expect(num(1.5, 'en')).toBe('1.5')
    S.locale = 'de'
    expect(minutes(1.5)).toBe('1,5 min')
    S.locale = 'en'
    expect(minutes(1.5)).toBe('1.5 min')
  })
})

describe('tab ids', () => {
  test('old and German names map to the English ids', () => {
    expect(normalizeTab('quellen')).toBe('sources')
    expect(normalizeTab('jobs')).toBe('sources')
    expect(normalizeTab('ci')).toBe('actions')
    expect(normalizeTab('Einstellungen')).toBe('settings')
    expect(normalizeTab('anleitung')).toBe('help')
    expect(normalizeTab('issues')).toBe('issues')
    expect(normalizeTab('edit')).toBeUndefined()
  })
})

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as const

type Boot = { toasts: string[]; files: Record<string, string>; commands: Array<{ name: string; description: string; argumentHint?: string }> }

async function boot($: Engine, on: On, opts: { language?: unknown; env?: Record<string, string>; settings?: Record<string, unknown> } = {}): Promise<Boot> {
  const calls: Boot = { toasts: [], files: {}, commands: [] }
  const path = '/preview/.claude/cockpit/cockpit.json'
  calls.files[path] = JSON.stringify({ ...DEFAULT_CONFIG, settings: { ...DEFAULT_CONFIG.settings, ...opts.settings } })
  mock.store(on)
  mock.clock(on, { now: 0 })
  mock.env(on, { HOME: '/preview', ...opts.env })
  on('fs.exists', async (_, e) => ({ value: e.path in calls.files }))
  on('fs.read', async (_, e) => ({ value: calls.files[e.path] ?? '' }))
  on('fs.write', async (_, e) => {
    calls.files[e.path] = e.text
    return { value: undefined }
  })
  on('settings.read', async () => ({ value: opts.language === undefined ? {} : { language: opts.language } }))
  on('command.list', async () => ({ value: [] }))
  on('tool.list', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.status', async () => ({ value: undefined }))
  on('ui.toast', async (_, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', async () => ({ value: undefined }))
  on('ui.panes', async () => ({ value: [] }))
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }))
  on('session.root', async () => ({ value: '/r' }))
  on('session.repo', async () => ({ value: null }))
  on('command.register', async (_, e) => {
    calls.commands.push(e as never)
    return { value: { command: e.name } }
  })
  on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', async (_, e) => e)
  return calls
}

async function mountPane($: Engine) {
  await $.session.start({ cwd: '/r', surface: 'terminal', isInteractive: false } as never)
  return $.ui.mount({
    plugin: 'cockpit',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'cockpit',
    props: { title: 'Cockpit', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as never)
}

describe('language in the engine', () => {
  test('auto follows the Claude Code language setting at session start', async ($, on) => {
    const calls = await boot($, on, { language: 'german' })
    const ui = await mountPane($)
    expect(String((await ui.find({ type: 'Button', key: 'tab-settings' }))?.props['label'])).toBe('Einstellungen')
    expect(calls.commands.at(-1)?.description).toContain('Einstellungen')
    expect(calls.commands.at(-1)?.argumentHint).toBe('[sources|actions|issues|settings|help]')
  })

  test('auto falls back to LANG, defaults to English', async ($, on) => {
    await boot($, on, { env: { LANG: 'de_DE.UTF-8' } })
    const ui = await mountPane($)
    expect(String((await ui.find({ type: 'Button', key: 'tab-help' }))?.props['label'])).toBe('Anleitung')
  })

  test('English without any hint', async ($, on) => {
    await boot($, on)
    const ui = await mountPane($)
    expect(String((await ui.find({ type: 'Button', key: 'tab-settings' }))?.props['label'])).toBe('Settings')
  })

  test('the picker switches the language and re-registers the command', async ($, on) => {
    const calls = await boot($, on, { language: 'german', settings: { language: 'en' } })
    const ui = await mountPane($)
    const help = async () => String((await ui.find({ type: 'Button', key: 'tab-help' }))?.props['label'])
    expect(await help()).toBe('Help')
    await ui.press({ key: 'tab-settings' })
    await ui.press({ key: 'set-language-de' })
    expect(JSON.parse(Object.values(calls.files)[0] ?? '{}').settings.language).toBe('de')
    expect(await help()).toBe('Anleitung')
    expect(calls.commands.at(-1)?.description).toContain('Anleitung')
    await ui.press({ key: 'set-language-auto' })
    expect(await help()).toBe('Anleitung')
    await ui.press({ key: 'set-language-en' })
    expect(await help()).toBe('Help')
    expect(calls.commands.at(-1)?.description).toContain('Help')
  })

  test('/cockpit accepts English ids and German aliases', async ($, on) => {
    await boot($, on)
    const ui = await mountPane($)
    for (const [args, tab] of [['settings', 'settings'], ['einstellungen', 'settings'], ['anleitung', 'help'], ['quellen', 'sources'], ['jobs', 'sources'], ['actions', 'actions']] as const) {
      await $.command.run({ ...RUN, command: 'cockpit', args } as never)
      expect((await ui.find({ type: 'Button', key: `tab-${tab}` }))?.props['variant']).toBe('primary')
    }
  })
})
