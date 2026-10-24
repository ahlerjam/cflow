import { atom, read, update } from 'claude-code'

import type { ActView } from '../../types'
import type { Verdict } from '../actions'
import { t } from '../i18n'
import { S } from '../state'
import { ghProblemText, hhmm, openUrl } from '../core'
import { analyzeLog, analyzeRunDetail, closeLog, closeRun, dispatchWorkflow, filterWorkflow, hasPoolUi, openLog, openRun, refreshCi, runAction, showActView, toggleAllRepos, toggleJob } from '../actions-io'
import { bar, poolVerdict, shortRepo, vmsPerRepo } from '../ci'
import { LOG_LINES_STEP, age, fit, fitLeft, isErrorLine, runColumns, runHeader, runRow, span, verdict } from '../actions'
import type { Eng } from '../state'
import { card, choice, dangerBtn, pill, switchBtn } from './ui'
import type { PaneView, Table } from './ui'

// Atoms are declared in every file that reads them: the mod loader only finds the source in a const of the file itself.
const actAllA = atom({ plugin: 'cockpit', key: 'actAllRepos' } as const, false)
const actJobA = atom({ plugin: 'cockpit', key: 'actJob' } as const, 0)
const actLogA = atom({ plugin: 'cockpit', key: 'actLog' } as const, null)
const actLogLimitA = atom({ plugin: 'cockpit', key: 'actLogLimit' } as const, 60)
const actOnlyErrA = atom({ plugin: 'cockpit', key: 'actOnlyErrors' } as const, false)
const actOpenA = atom({ plugin: 'cockpit', key: 'actOpen' } as const, null)
const actRunA = atom({ plugin: 'cockpit', key: 'actRun' } as const, null)
const actStepA = atom({ plugin: 'cockpit', key: 'actStep' } as const, '')
const actViewA = atom({ plugin: 'cockpit', key: 'actView' } as const, 'runs')
const actWfA = atom({ plugin: 'cockpit', key: 'actWorkflows' } as const, null)
const actWfFilterA = atom({ plugin: 'cockpit', key: 'actWorkflowFilter' } as const, '')
const ciA = atom({ plugin: 'cockpit', key: 'ci' } as const, null)

export async function actionsTab($: Eng, table: Table, pane: PaneView) {
  const { Box, Button, Code, Text } = table
  const { pending } = pane
  const ci = await read($, ciA)
  const now = await $.clock.now()
  const W = Math.max(44, (pane.bodyColumns || 70) - 1)
  const hasPool = hasPoolUi()
  const storedView = await read($, actViewA)
  const view = storedView === 'runners' && !hasPool ? 'runs' : storedView
  const opened = await read($, actOpenA)
  const run = await read($, actRunA)
  const log = await read($, actLogA)
  const toneColor = (tone: Verdict['tone']) => (tone === 'success' ? 'success' : tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : undefined)
  const vIcon = (key: string, status: string, conclusion: string) => {
    const v = verdict(status, conclusion)
    return (
      <Text key={key} color={toneColor(v.tone)} dimColor={v.tone === 'dim'}>
        {v.icon}
      </Text>
    )
  }

  const fleet = ci?.fleet
  // Header numbers always come from /health; only the VM list can be demo data
  const pool = ci?.pool ?? null
  const loaded = pool ? pool.ready + pool.busy : fleet ? fleet.vms.length : 0
  const busy = pool ? pool.busy : fleet ? fleet.vms.filter(v => v.state !== 'ready').length : 0
  const waiting = ci?.pool?.demand ?? 0
  const maxPool = fleet?.maxPool ?? null
  const hereRuns = (ci?.runs ?? []).filter(r => !ci?.repo || r.repo === ci.repo)
  const running = hereRuns.filter(r => r.status === 'in_progress').length
  const queued = hereRuns.filter(r => r.status === 'queued').length
  const poolCard = card(table, 'runner-card', W, { text: ci?.repo && !ci.isDemo ? t('act.runnerRepo', { repo: ci.repo }) : t('act.runner'), badge: pool ? t('act.asOf', { time: hhmm(Math.max(ci?.at ?? 0, ci?.poolAt ?? 0)) }) : t('act.noData') }, [], undefined, [
    <Box key="runner-load" flexDirection="row" columnGap={1}>
      {maxPool !== null && <Text color={loaded >= maxPool ? 'warning' : 'claude'}>{bar(loaded, maxPool, 16)}</Text>}
      <Text bold>{maxPool !== null ? `${loaded}/${maxPool}` : loaded}</Text>
      <Text dimColor>{t('act.loadedVms')}  </Text>
      <Text color={busy ? 'success' : undefined} bold={busy > 0}>
        {busy}
      </Text>
      <Text dimColor>{t('act.activeVms')}  </Text>
      <Text color={waiting ? 'warning' : undefined} bold={waiting > 0}>
        {waiting}
      </Text>
      <Text dimColor>{t('act.waitingJobs')}</Text>
    </Box>,
  ])
  const summaryCard = card(table, 'runs-card', W, { text: ci?.repo ? t('act.runsRepo', { repo: ci.repo }) : t('act.runsTitle'), badge: ci ? t('act.asOf', { time: hhmm(ci.at) }) : t('act.noData') }, [], undefined, [
    <Text key="runs-summary">{t('act.summary', { running, queued })}</Text>,
  ])
  const views: ActView[] = hasPool ? ['runs', 'runners', 'workflows'] : ['runs', 'workflows']
  const header = (
    <Box flexDirection="column" rowGap={1}>
      {hasPool ? poolCard : summaryCard}
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {views.map(v => (
          pill(table, `act-${v}`, t(v === 'runs' ? 'act.viewRuns' : v === 'runners' ? 'act.viewRunners' : 'act.viewWorkflows'), () => void showActView($, v), {
            variant: view === v && !opened ? 'primary' : 'secondary',
          })
        ))}
        <Box flexGrow={1} />
        {pill(table, 'act-refresh', t('common.refresh'), () => void refreshCi($))}
      </Box>
    </Box>
  )

  let content
  if (opened && log) {
    const stepName = await read($, actStepA)
    const onlyErrors = await read($, actOnlyErrA)
    const limit = await read($, actLogLimitA)
    const step = log.steps.find(s => s.name === stepName) ?? log.steps.at(-1)
    const all = step ? (onlyErrors ? step.lines.filter(isErrorLine) : step.lines) : []
    const shown = all.slice(-limit)
    const logJob = run?.jobs.find(j => j.id === log.jobId)
    const lv = verdict(logJob?.status ?? 'completed', logJob?.conclusion ?? '')
    content = (
      <Box flexDirection="column" rowGap={1}>
        {pill(table, 'log-back', t('act.backRun'), () => void closeLog($))}
        {card(
          table,
          'log-card',
          W,
          { icon: lv.icon, tone: toneColor(lv.tone), text: `${log.jobName} · ${lv.long}` },
          [
            [t('act.step'), step?.name ?? '–'],
            [t('act.lines'), step ? String(step.lines.length) : '–'],
            [t('act.run'), run?.workflow ?? '–'],
            [t('act.branch'), run?.branch ?? '–'],
            [t('act.time'), logJob ? span(logJob.startedAt, logJob.completedAt, now) : '–'],
            [t('act.repo'), run ? (run.repo.split('/').pop() ?? run.repo) : '–'],
          ],
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {switchBtn(table, 'log-err', t('act.onlyErrors'), onlyErrors, () => void update($, actOnlyErrA, v => !v))}
          {all.length > shown.length && (
            pill(table, 'log-more', t('act.moreLines', { n: LOG_LINES_STEP }), () => void update($, actLogLimitA, v => v + LOG_LINES_STEP))
          )}
          {pill(table, 'log-ai', t('act.toClaude'), () => void analyzeLog($), { color: 'claude', variant: 'primary' })}
          {run && pill(table, 'log-web', t('act.browser'), () => void openUrl($, logJob?.url ?? run.url))}
        </Box>
        {log.steps.length > 1 &&
          choice(table,
            'log-step',
            t('act.step'),
            step?.name ?? '',
            log.steps.map(s => ({ value: s.name, label: `${s.name} (${s.lines.length})` })),
            v => void update($, actStepA, () => v),
          )}
        {log.error && <Text color="warning">{log.error}</Text>}
        {!log.error && log.steps.length === 0 && <Text dimColor>{t('act.logLoading')}</Text>}
        {shown.length > 0 && <Code source={shown.map(l => (l.length > W ? `${l.slice(0, W - 1)}…` : l)).join('\n')} language="text" wrap="truncate-end" />}
        {step && (
          <Text dimColor>
            {onlyErrors ? t('act.errorLines', { n: all.length, total: step.lines.length }) : t('act.linesShown', { shown: shown.length, all: all.length })}
          </Text>
        )}
      </Box>
    )
  } else if (opened) {
    const openJob = await read($, actJobA)
    const isRunning = run ? run.status !== 'completed' : false
    const hasFailed = run ? run.jobs.some(j => j.conclusion === 'failure' || j.conclusion === 'timed_out') : false
    const nameW = Math.max(12, W - 16)
    const rv = run ? verdict(run.status, run.conclusion) : null
    const okJobs = run ? run.jobs.filter(j => j.conclusion === 'success').length : 0
    const badJobs = run ? run.jobs.filter(j => ['failure', 'timed_out', 'cancelled'].includes(j.conclusion)).length : 0
    const runningJobs = run ? run.jobs.filter(j => j.status !== 'completed').length : 0
    content = !run || !rv ? (
      <Box flexDirection="column" rowGap={1}>
        {pill(table, 'run-back', t('act.backRuns'), () => void closeRun($))}
        <Text dimColor>{t('act.runLoading', { id: opened.runId })}</Text>
      </Box>
    ) : (
      <Box flexDirection="column" rowGap={1}>
        {pill(table, 'run-back', t('act.backRuns'), () => void closeRun($))}
        {card(
          table,
          'run-card',
          W,
          { icon: rv.icon, tone: toneColor(rv.tone), text: `${run.workflow} · ${rv.long}` },
          [
            [t('act.repo'), run.repo.split('/').pop() ?? run.repo],
            [t('act.branch'), run.branch],
            [t('act.commit'), run.sha],
            [t('act.event'), run.event],
            [t('act.time'), span(run.startedAt, run.status === 'completed' ? run.updatedAt : '', now)],
            [t('act.age'), t('act.attempt', { age: age(run.createdAt, now), n: run.attempt })],
          ],
          run.title || undefined,
        )}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {pill(table, 'run-web', t('act.browser'), () => void openUrl($, run.url))}
          {hasFailed && pill(table, 'run-ai', t('act.toClaude'), () => void analyzeRunDetail($, run), { color: 'claude', variant: 'primary' })}
          {hasFailed && dangerBtn($, table, pending, 'run-rerun-failed', t('act.rerunFailed'), () => void runAction($, run, 'rerun-failed'))}
          {!isRunning && dangerBtn($, table, pending, 'run-rerun', t('act.rerunAll'), () => void runAction($, run, 'rerun'))}
          {isRunning && dangerBtn($, table, pending, 'run-cancel', t('act.cancel'), () => void runAction($, run, 'cancel'))}
        </Box>
        <Box flexDirection="column">
          <Box flexDirection="row" columnGap={1}>
            <Text bold color="claude">
              {t('act.jobs')}
            </Text>
            {okJobs > 0 && <Text color="success">{okJobs} ✓</Text>}
            {badJobs > 0 && <Text color="error">{badJobs} ✗</Text>}
            {runningJobs > 0 && <Text color="warning">{runningJobs} ●</Text>}
            <Box flexGrow={1} />
            <Text dimColor>{t('act.time')}</Text>
          </Box>
          {run.jobs.map(j => {
            const isOpen = j.id === openJob
            return (
              <Box key={`jobrow-${j.id}`} flexDirection="column">
                <Box flexDirection="row" columnGap={1}>
                  {vIcon(`job-icon-${j.id}`, j.status, j.conclusion)}
                  <Button
                    key={`job-${j.id}`}
                    plain
                    label={`${isOpen ? '▾' : '▸'} ${fit(j.name, nameW)} ${fitLeft(span(j.startedAt, j.completedAt, now), 6)}`}
                    onPress={() => void toggleJob($, j.id)}
                  />
                </Box>
                {isOpen && (
                  <Box flexDirection="column" paddingLeft={2}>
                    {j.steps.map(st => (
                      <Box key={`steprow-${j.id}-${st.number}`} flexDirection="row" columnGap={1}>
                        <Text dimColor>│</Text>
                        {vIcon(`step-icon-${j.id}-${st.number}`, st.status, st.conclusion)}
                        <Button
                          key={`step-${j.id}-${st.number}`}
                          plain
                          dimColor={st.conclusion === 'skipped'}
                          label={`${fit(st.name, nameW - 4)} ${fitLeft(st.startedAt ? span(st.startedAt, st.completedAt, now) : '', 6)}`}
                          onPress={() => void openLog($, j, st.name)}
                        />
                      </Box>
                    ))}
                    <Box flexDirection="row" columnGap={1} alignItems="center">
                      <Text dimColor>└</Text>
                      {pill(table, `job-log-${j.id}`, t('act.viewLog'), () => void openLog($, j))}
                      {pill(table, `job-web-${j.id}`, t('act.browser'), () => void openUrl($, j.url))}
                    </Box>
                  </Box>
                )}
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  } else if (view === 'runners') {
    const perRepo = fleet ? vmsPerRepo(fleet.vms) : []
    const repoW = 14
    const jobW = Math.max(8, W - (2 + 20 + 1 + 6 + 1 + 5 + 1 + repoW + 1))
    const ageSec = pool && ci ? Math.max(0, Math.round((now - ci.poolAt) / 1000)) : 0
    const pv = pool ? poolVerdict(pool, ageSec) : null
    const states = pool ? Object.entries(pool.states).filter(([, n]) => n > 0) : []
    const health = card(
      table,
      'health-card',
      W,
      {
        text: t('act.poolHealth'),
        ...(pv ? { icon: pv.tone === 'success' ? '●' : pv.tone === 'dim' ? '○' : '▲', tone: pv.tone === 'dim' ? undefined : pv.tone } : {}),
        ...(pool ? {} : { badge: t('act.loadingBadge') }),
      },
      pool
        ? [
            [t('act.mode'), pool.mode],
            [t('act.repos'), t('act.reposActive', { active: pool.active, managed: pool.managed ?? '?' })],
            [t('act.vms'), t('act.vmsValue', { n: pool.ready + pool.busy, busy: pool.busy, ready: pool.ready })],
            [t('act.waiting'), t('act.jobsCount', { n: pool.demand })],
            [t('act.sizes'), t('act.sizesValue', { normal: pool.normal, large: pool.large })],
            [t('act.status'), states.length ? states.map(([s, n]) => `${s} ${n}`).join(', ') : t('act.noVm')],
          ]
        : [[t('act.error'), ci?.poolError ?? t('act.noAnswerYet')]],
      undefined,
      pv
        ? [
            <Text key="health-verdict" color={pv.tone === 'dim' ? undefined : pv.tone} dimColor={pv.tone === 'dim'}>
              {pv.text}
            </Text>,
          ]
        : [],
    )
    content = (
      <Box flexDirection="column" rowGap={1}>
        {health}
        {!fleet && <Text dimColor>{ci?.fleetError ?? t('common.loading')}</Text>}
        {fleet && (
          <Box flexDirection="column">
            <Text bold color="claude">
              {fleet.maxRunnersPerRepo !== null ? t('act.perRepo', { n: fleet.maxRunnersPerRepo }) : t('act.perRepoNoMax')}{ci?.isDemo ? t('act.demoVmList') : ''}
            </Text>
            {perRepo.map(r => (
              <Text key={`per-${r.repo}`} color={fleet.maxRunnersPerRepo !== null && r.count >= fleet.maxRunnersPerRepo ? 'warning' : undefined}>
                {fit(r.repo, 18)} {fleet.maxRunnersPerRepo !== null ? `${bar(r.count, fleet.maxRunnersPerRepo, 8)} ${r.count}/${fleet.maxRunnersPerRepo}` : r.count}
              </Text>
            ))}
          </Box>
        )}
        {fleet && (
          <Box flexDirection="column">
            <Text dimColor>
              {'  '}
              {fit(t('act.vm'), 20)} {fit(t('act.size'), 6)} {fitLeft(t('act.age'), 5)} {fit(t('act.repo'), repoW)} {fit(t('act.job'), jobW)}
            </Text>
            {fleet.vms.map(v => {
              const isBusy = v.state !== 'ready'
              const label = `${fit(v.name, 20)} ${fit(t(v.size === 'large' ? 'act.sizeLarge' : 'act.sizeNormal'), 6)} ${fitLeft(age(new Date(v.createdAt).toISOString(), now), 5)} ${fit(shortRepo(v.repo), repoW)} ${fit(v.job ?? (isBusy ? v.state : t('act.free')), jobW)}`
              return (
                <Box key={`vm-${v.name}`} flexDirection="row" columnGap={1}>
                  <Text color={isBusy ? 'success' : undefined} dimColor={!isBusy}>
                    {isBusy ? '●' : '○'}
                  </Text>
                  {v.runId ? (
                    <Button key={`vm-${v.name}`} plain label={label} onPress={() => void openRun($, v.repo, v.runId, v.jobId)} />
                  ) : (
                    <Text dimColor={!isBusy}>{label}</Text>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  } else if (view === 'workflows') {
    const wfs = await read($, actWfA)
    const nameW = Math.max(12, W - 34)
    content = (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>{S.workflowRepo || t('act.viewWorkflows')}</Text>
        {wfs === null && <Text dimColor>{t('common.loading')}</Text>}
        {wfs?.length === 0 && <Text dimColor>{t('act.noWorkflows')}</Text>}
        {wfs?.map(w => {
          const last = ci?.runs.find(r => r.name === w.name && r.repo === S.workflowRepo)
          const isActive = w.state === 'active'
          return (
            <Box key={`wf-${w.id}`} flexDirection="row" columnGap={1} alignItems="center">
              {last ? vIcon(`wf-icon-${w.id}`, last.status, last.conclusion) : <Text dimColor>·</Text>}
              <Button key={`wf-runs-${w.id}`} plain dimColor={!isActive} label={`${fit(w.name, nameW)}${isActive ? '' : t('act.wfOff')}`} onPress={() => void filterWorkflow($, w.name)} />
              {isActive && dangerBtn($, table, pending, `wf-run-${w.id}`, t('act.start'), () => void dispatchWorkflow($, w))}
              <Button key={`wf-web-${w.id}`} plain label="↗" onPress={() => void openUrl($, `https://github.com/${S.workflowRepo}/actions/workflows/${w.path.split('/').pop() ?? ''}`)} />
            </Box>
          )
        })}
      </Box>
    )
  } else {
    const isAll = await read($, actAllA)
    const wfFilter = await read($, actWfFilterA)
    const runs = (ci?.runs ?? []).filter(r => !wfFilter || r.name === wfFilter)
    const cols = runColumns(W, isAll)
    content = (
      <Box flexDirection="column" rowGap={1}>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {switchBtn(table, 'act-all', t('act.allRepos'), isAll, () => void toggleAllRepos($))}
          {wfFilter && pill(table, 'act-unfilter', wfFilter, () => void update($, actWfFilterA, () => ''), { icon: '×', color: 'warning', variant: 'primary' })}
          {ci?.pr && (
            <Button
              key="ci-pr"
              plain
              label={`PR #${ci.pr.number}  ✓${ci.pr.checks.passed} ✗${ci.pr.checks.failed} …${ci.pr.checks.pending}`}
              onPress={() => void openUrl($, ci.pr?.url ?? '')}
            />
          )}
        </Box>
        <Box flexDirection="column">
          <Text dimColor>{runHeader(cols)}</Text>
          {ci === null && <Text dimColor>{t('common.loading')}</Text>}
          {ci && runs.length === 0 && !ci.problem && <Text dimColor>{ci.ghError ?? t('act.noRuns')}</Text>}
          {!ci?.ghError && Object.entries(ci?.repoErrors ?? {}).map(([repo, error]) => (
            <Text key={`run-err-${repo}`} color="warning" wrap="truncate-end">{`${shortRepo(repo)}: ${error}`}</Text>
          ))}
          {runs.map(r => (
            <Box key={`run-${r.id}`} flexDirection="row" columnGap={1}>
              {vIcon(`run-icon-${r.id}`, r.status, r.conclusion)}
              <Button key={`run-open-${r.id}`} plain label={runRow(r, cols, now)} onPress={() => void openRun($, r.repo, r.id)} />
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" rowGap={1}>
      {header}
      {ci?.problem && !opened && <Text color="warning">{ghProblemText(ci.problem, ci.retryAt)}</Text>}
      {content}
      {ci?.ghError && !opened && view !== 'runs' && <Text color="error">{ci.ghError}</Text>}
    </Box>
  )
}
