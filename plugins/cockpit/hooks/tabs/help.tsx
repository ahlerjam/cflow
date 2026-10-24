import { atom, update } from 'claude-code'

import { fit } from '../actions'
import { toast } from '../core'
import { HELP_SYSTEM, helpAsText, helpCommands, helpSections } from '../help-text'
import { t } from '../i18n'
import { AI_MODEL, S } from '../state'
import type { Eng } from '../state'
import { pill, section, textField } from './ui'
import type { PaneView, Table } from './ui'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const cfgVerA = atom({ plugin: 'cockpit', key: 'configVersion' } as const, 0)

export async function fillCommand($: Eng, text: string): Promise<void> {
  const r = await $.prompt.fill({ text, mode: 'replace' })
  if (r.isFilled) toast($, t('help.filled', { text: text.trim() }))
  else toast($, t('help.inputBusy', { text: text.trim() }))
}

export async function askHelp($: Eng, question: string): Promise<void> {
  const q = question.trim()
  if (!q) return
  S.help = { question: q, answer: '', isBusy: true }
  await update($, cfgVerA, v => v + 1)
  let answer = ''
  try {
    const r = await $.model.complete({
      model: AI_MODEL,
      system: HELP_SYSTEM,
      prompt: [{ text: helpAsText(), cache: true }, { text: `Question: ${q}` }],
      maxTokens: 600,
      effort: 'low',
      timeoutMs: 30_000,
    })
    answer = r.isAnswered ? r.text.trim() : t('help.noAnswer', { reason: r.reason })
  } catch (err) {
    answer = t('help.noAnswerError', { error: String(err).slice(0, 100) })
  }
  S.help = { question: q, answer, isBusy: false }
  await update($, cfgVerA, v => v + 1)
}

export async function helpTab($: Eng, table: Table, pane: PaneView) {
  const { Box, Markdown, Text } = table
  const W = Math.max(44, (pane.bodyColumns || 70) - 1)
  const inner = W - 4
  const cmdW = Math.min(36, Math.max(20, Math.floor(inner * 0.42)))
  const help = S.help

  return (
    <Box flexDirection="column" rowGap={1}>
      {section(table, 'help-ask', t('help.askTitle'), 'claude',
        <Box flexDirection="column">
          {textField(table, 'help-q', t('help.questionLabel'), '', t('help.questionPlaceholder'), v => void askHelp($, v))}
          {help && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="claude" bold>
                {fit(`» ${help.question}`, inner)}
              </Text>
              {help.isBusy ? <Text color="warning">{t('help.answering', { model: AI_MODEL })}</Text> : <Markdown text={help.answer} />}
            </Box>
          )}
        </Box>,
        <Text dimColor>{AI_MODEL}</Text>,
      )}

      {section(table, 'help-cmd', t('help.cmdTitle'), 'success',
        <Box flexDirection="column">
          {helpCommands().map((c, i) => (
            <Box key={`help-cmd-${i}`} flexDirection="row" columnGap={1} alignItems="center">
              <Box width={cmdW} flexShrink={0}>
                {pill(table, `help-run-${i}`, fit(c.cmd, cmdW - 4).trimEnd(), () => void fillCommand($, c.fill))}
              </Box>
              <Box width={Math.max(10, inner - cmdW - 1)} flexShrink={0}>
                <Text wrap="wrap">{c.what}</Text>
              </Box>
            </Box>
          ))}
        </Box>,
        <Text dimColor>{t('help.cmdHint')}</Text>,
      )}

      {helpSections().map(s => section(table, `help-${s.id}`, s.title, s.color, <Markdown text={s.lines.join('\n')} />))}
    </Box>
  )
}
