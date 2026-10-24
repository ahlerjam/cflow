import type { RenderChildren } from 'claude-code'

import { minutes, t } from '../i18n'
import { CI_INTERVAL_SECS, ISSUE_LIMITS, QUEUED_MINUTES, S, SUMMARY_MODELS } from '../state'
import { discover, edit, setSetting } from '../core'
import { setCiInterval } from '../actions-io'
import { setSummaryModel, toggleSummaries } from '../issues-io'
import { addMarker, reloadAll, resetConfig, toggleDemo } from '../nav'
import { httpsHost, setMarker } from '../sources'
import type { Eng } from '../state'
import { STATE_LABEL, dangerBtn, onOff, pill, section, segmented, settingRow, textField } from './ui'
import type { PaneView, Table } from './ui'

// Wide enough for the longest row title in English and German
const LABEL_W = 26

// Sections with a row per setting: name on the left, every choice as a button on the right
export async function settingsTab($: Eng, table: Table, pane: PaneView) {
  const { Box, Text } = table
  const { pending } = pane
  const s = S.cfg.settings
  const inner = Math.max(44, (pane.bodyColumns || 70) - 1) - 4
  const row = (key: string, title: string, control: RenderChildren) => settingRow(table, key, title, LABEL_W, inner, control)
  const markers = Object.entries(S.cfg.startupMarkers)
  const ciIntervals = CI_INTERVAL_SECS.map(sec => ({ value: String(sec), label: sec === 0 ? t('interval.off') : minutes(sec / 60) }))
  const queuedOptions = QUEUED_MINUTES.map(m => ({ value: String(m), label: minutes(m) }))
  const languages = [
    { value: 'auto', label: t('set.langAuto') },
    { value: 'en', label: t('set.langEn') },
    { value: 'de', label: t('set.langDe') },
  ]

  return (
    <Box flexDirection="column" rowGap={1}>
      {section(table, 'sec-allg', t('set.general'), 'suggestion',
        <Box flexDirection="column">
          {row('set-open', t('set.openOnStart'), onOff(table, 'set-open', s.openOnStart, () => void setSetting($, 'openOnStart', !s.openOnStart)))}
          {row('set-default', t('set.newSources'), segmented(table, 'set-default', s.defaultState, [{ value: 'on', label: STATE_LABEL.on }, { value: 'off', label: STATE_LABEL.off }], v =>
            void setSetting($, 'defaultState', v === 'off' ? 'off' : 'on'),
          ))}
          <Text dimColor>{t('set.newSourcesHint')}</Text>
          {row('set-toasts', t('set.toasts'), onOff(table, 'set-toasts', s.toasts, () => void setSetting($, 'toasts', !s.toasts)))}
          {row('set-language', t('set.language'), segmented(table, 'set-language', s.language, languages, v =>
            void setSetting($, 'language', v === 'en' || v === 'de' ? v : 'auto'),
          ))}
        </Box>,
      )}

      {section(table, 'sec-ci', t('set.actionsIssues'), 'autoAccept',
        <Box flexDirection="column">
          {row('set-ci', t('set.pollRuns'), segmented(table, 'set-ci', String(s.ciEverySec), ciIntervals, v => void setCiInterval($, Number(v))))}
          {row('set-notify', t('set.notifyRunEnd'), onOff(table, 'set-notify', s.notifyRunEnd, () => void setSetting($, 'notifyRunEnd', !s.notifyRunEnd)))}
          {row('set-queued', t('set.queuedAlert'), segmented(table, 'set-queued', String(s.queuedAlertMin), queuedOptions, v =>
            void setSetting($, 'queuedAlertMin', Number(v)),
          ))}
          {row('set-issues', t('set.issuesLoad'), segmented(table, 'set-issues', String(s.issueLimit), ISSUE_LIMITS, v => void setSetting($, 'issueLimit', Number(v))))}
          {row('set-sum', t('set.aiSummary'), onOff(table, 'set-sum', s.issueSummaries, () => void toggleSummaries($)))}
          {row('set-sum-model', t('set.sumModel'), segmented(table, 'set-sum-model', s.summaryModel, SUMMARY_MODELS, v => void setSummaryModel($, v)))}
          {row('set-pool', t('set.pool'), (
            <Text dimColor={!s.runnerPool}>{s.runnerPool ? t('set.poolOn', { name: s.runnerPool.label ?? httpsHost(s.runnerPool.healthUrl) ?? '' }) : t('set.poolNone')}</Text>
          ))}
          {row('set-demo', t('set.demo'), onOff(table, 'set-demo', s.demo, () => void toggleDemo($)))}
        </Box>,
      )}

      {section(table, 'sec-marker', t('set.markers'), 'warning',
        <Box flexDirection="column">
          {markers.map(([plugin, marker]) => (
            <Box key={`marker-${plugin}`} flexDirection="row" columnGap={1} alignItems="center">
              <Box width={LABEL_W} flexShrink={0}>
                <Text color="warning">{plugin}</Text>
              </Box>
              <Text>{t('set.markerQuoted', { marker })}</Text>
              <Box flexGrow={1} />
              {pill(table, `marker-del-${plugin}`, t('set.remove'), () => void edit($, c => setMarker(c, plugin, null)), { color: 'error' })}
            </Box>
          ))}
          {textField(table, 'set-marker', t('set.new'), '', t('set.markerPlaceholder'), v => void addMarker($, v))}
        </Box>,
        <Text dimColor>{markers.length}</Text>,
      )}

      {section(table, 'sec-file', t('set.file'), 'subtle',
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-start">
            {S.cfgPath}
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {pill(table, 'set-reload', t('set.reload'), () => void reloadAll($))}
            {pill(table, 'set-rescan', t('set.rescan'), () => void discover($))}
          </Box>
          <Box flexDirection="row">
            {dangerBtn($, table, pending, 'reset', t('set.reset'), () => void resetConfig($))}
          </Box>
        </Box>,
      )}
    </Box>
  )
}
