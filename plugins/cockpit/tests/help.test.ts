import { describe, expect, test } from 'claude-code/testing'

import { HELP_COMMANDS, HELP_SECTIONS, HELP_SYSTEM, helpAsText } from '../hooks/help-text'

describe('help content', () => {
  test('both locales have the same commands and section ids in the same order', () => {
    expect(HELP_COMMANDS.de.map(c => c.fill)).toEqual(HELP_COMMANDS.en.map(c => c.fill))
    expect(HELP_SECTIONS.de.map(s => s.id)).toEqual(HELP_SECTIONS.en.map(s => s.id))
    expect(HELP_SECTIONS.de.map(s => s.color)).toEqual(HELP_SECTIONS.en.map(s => s.color))
  })

  test('helpAsText follows the locale', () => {
    expect(helpAsText('en')).toContain('## Sources: on · off · never')
    expect(helpAsText('de')).toContain('## Quellen: an · aus · nie')
    expect(helpAsText('en')).not.toContain('Quellen')
  })

  test('the AI help is told to answer in the language of the question', () => {
    expect(HELP_SYSTEM).toContain('language of the question')
  })
})
