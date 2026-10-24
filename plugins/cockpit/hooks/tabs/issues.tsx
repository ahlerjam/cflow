import { atom, read } from 'claude-code'
import type { Color, RenderChildren } from 'claude-code'

import type { Issue, IssueRef } from '../../types'
import { S } from '../state'
import { t } from '../i18n'
import { ghProblemText, openUrl } from '../core'
import { closeIssue, openIssue, refreshIssues, resetIssueFilters, searchIssues, setIssueFilter, setIssuePage, toggleIssueTask, toggleSummaries, workOnIssue } from '../issues-io'
import { ago, bar } from '../ci'
import { fit } from '../actions'
import { ANY, NAMED, NO_LABEL, childrenOf, clipSegs, epicOf, isFiltered, normalizeFilters, splitBody, subtasksOf, summaryKey } from '../issues'
import type { Seg } from '../issues'
import type { Eng } from '../state'
import { CHIP_PAD, card, chip, choice, switchBtn } from './ui'
import type { Option, PaneView, Table } from './ui'

// Declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const detailA = atom({ plugin: 'cockpit', key: 'issueDetail' } as const, null)
const issuesA = atom({ plugin: 'cockpit', key: 'issues' } as const, null)
const stateA = atom({ plugin: 'cockpit', key: 'issueState' } as const, 'open')
const sortA = atom({ plugin: 'cockpit', key: 'issueSort' } as const, 'updated-desc')
const labelA = atom({ plugin: 'cockpit', key: 'issueLabel' } as const, 'any')
const kindA = atom({ plugin: 'cockpit', key: 'issueKind' } as const, 'any')
const assigneeA = atom({ plugin: 'cockpit', key: 'issueAssignee' } as const, 'any')
const optionsA = atom({ plugin: 'cockpit', key: 'issueOptions' } as const, null)
const openIssueA = atom({ plugin: 'cockpit', key: 'openIssue' } as const, 0)
const pageA = atom({ plugin: 'cockpit', key: 'issuePage' } as const, 0)
const queryA = atom({ plugin: 'cockpit', key: 'issueQuery' } as const, '')
const summariesA = atom({ plugin: 'cockpit', key: 'summaries' } as const, {})
const taskBusyA = atom({ plugin: 'cockpit', key: 'issueTaskBusy' } as const, '')

// First, last and two around the current page; gaps as "…"
export function pageNumbers(page: number, pages: number): Array<number | '…'> {
  const keep = [...new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2])].filter(n => n >= 0 && n < pages).sort((a, b) => a - b)
  const out: Array<number | '…'> = []
  for (const n of keep) {
    const prev = out[out.length - 1]
    if (typeof prev === 'number' && n - prev > 1) out.push('…')
    out.push(n)
  }
  return out
}

export async function issuesTab($: Eng, table: Table, pane: PaneView) {
  const { Box, Button, Markdown, Text } = table
  const Input = 'Input' in table ? table.Input : undefined
  const hasSelect = 'Select' in table
  const list = await read($, issuesA)
  const query = await read($, queryA)
  const filters = normalizeFilters({
    state: await read($, stateA),
    sort: await read($, sortA),
    label: await read($, labelA),
    kind: await read($, kindA),
    assignee: await read($, assigneeA),
  })
  const options = await read($, optionsA)
  const summaries = await read($, summariesA)
  const openNo = await read($, openIssueA)
  const taskBusy = await read($, taskBusyA)
  const now = await $.clock.now()
  const items = list?.items ?? []
  const sumOf = (i: Issue): string | undefined =>
    S.cfg.settings.issueSummaries && list?.repo ? summaries[summaryKey(list.repo, i, S.locale)] : undefined
  const W = Math.max(44, (pane.bodyColumns || 70) - 1)
  const inner = W - 4
  const bodyW = inner - 2
  const labelChips = (i: Issue) => (
    <Box flexDirection="row" flexWrap="wrap" columnGap={1} width={bodyW}>
      {i.kind && <Text key={`kind-${i.number}`} bold color="permission">[{i.kind}]</Text>}
      {i.labels.map(l => (
        <Text key={`lbl-${i.number}-${l.name}`} color={`#${l.color}`}>
          ● {l.name}
        </Text>
      ))}
    </Box>
  )
  const REL_KEYS = ['iss.relEpic', 'iss.relSubtasks', 'iss.relBlockedBy', 'iss.relBlocks', 'iss.relPr'] as const
  const REL_W = Math.max(...REL_KEYS.map(k => t(k).length))
  const refW = Math.max(12, bodyW - REL_W - 1)
  const refBtn = (key: string, r: IssueRef) => (
    <Button
      key={key}
      plain
      label={fit(`#${r.number}${r.title ? ` ${r.title}` : ''}${r.state === 'CLOSED' ? ' ✓' : ''}`, refW).trimEnd()}
      onPress={() => void openIssue($, r.number)}
    />
  )
  const relRow = (key: string, text: string, color: Color | undefined, children: RenderChildren) => (
    <Box key={key} flexDirection="row" columnGap={1} width={bodyW}>
      <Box width={REL_W} flexShrink={0}>
        <Text color={color}>{fit(text, REL_W)}</Text>
      </Box>
      <Box flexDirection="column" flexShrink={1}>
        {children}
      </Box>
    </Box>
  )
  const relations = (i: Issue) => {
    const epic = epicOf(i, items)
    const kids = i.isEpic ? childrenOf(i.number, items) : []
    const total = Math.max(i.subTotal, kids.length, i.children.length)
    const done = Math.min(i.subDone, total)
    const barW = 10
    const filled = total > 0 ? Math.min(barW, Math.round((done / total) * barW)) : 0
    return (
      <Box flexDirection="column">
        {epic && relRow(`ep-${i.number}`, t('iss.relEpic'), 'claude', refBtn(`ep-btn-${i.number}`, epic))}
        {i.isEpic && total > 0 &&
          relRow(
            `epb-${i.number}`,
            t('iss.relSubtasks'),
            'claude',
            <Box flexDirection="row" columnGap={1}>
              <Text color={done === total ? 'success' : 'claude'}>{bar(done, total, barW).slice(0, filled)}</Text>
              <Text dimColor>{bar(done, total, barW).slice(filled)}</Text>
              <Text color={done === total ? 'success' : undefined}>
                {done}/{total}
              </Text>
            </Box>,
          )}
        {i.isEpic && (
          <Box flexDirection="column" paddingLeft={2}>
            {subtasksOf(i, items).map((sub, n, all) => (
              <Box key={`sub-${i.number}-${sub.number}`} flexDirection="row" columnGap={1}>
                <Text dimColor>{n === all.length - 1 ? '└' : '├'}</Text>
                <Text color={sub.isDone ? 'success' : 'warning'}>{sub.isDone ? '✓' : '○'}</Text>
                <Button
                  key={`sub-open-${i.number}-${sub.number}`}
                  plain
                  dimColor={sub.isDone}
                  label={fit(`#${sub.number}  ${sub.title || t('iss.notLoaded')}`, Math.max(12, bodyW - 8)).trimEnd()}
                  onPress={() => void openIssue($, sub.number)}
                />
              </Box>
            ))}
          </Box>
        )}
        {i.blockedBy.length > 0 &&
          relRow(
            `bb-${i.number}`,
            t('iss.relBlockedBy'),
            i.blockedBy.some(r => r.state !== 'CLOSED') ? 'error' : 'success',
            i.blockedBy.map(r => refBtn(`bb-${i.number}-${r.number}`, r)),
          )}
        {i.blocking.length > 0 &&
          relRow(`bl-${i.number}`, t('iss.relBlocks'), 'warning', i.blocking.map(r => refBtn(`bl-${i.number}-${r.number}`, r)))}
        {i.prs.map(pr =>
          relRow(
            `pr-${i.number}-${pr.number}`,
            t('iss.relPr'),
            pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'success' : 'inactive',
            <Text color={pr.state === 'MERGED' ? 'merged' : undefined} dimColor={pr.state === 'CLOSED'}>
              {fit(`#${pr.number} ${pr.title} (${t(pr.state === 'OPEN' ? 'iss.prOpen' : pr.state === 'MERGED' ? 'iss.prMerged' : 'iss.prClosed')})`, refW).trimEnd()}
            </Text>,
          ),
        )}
      </Box>
    )
  }
  const section = (key: string, title: string, color: Color, children: RenderChildren) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={W}>
      <Text bold color={color}>
        {title}
      </Text>
      <Box flexDirection="column" width={inner}>
        {children}
      </Box>
    </Box>
  )

  const description = (i: Issue) => {
    const body = i.body.trim()
    if (!body) return <Markdown text={t('iss.noDescription')} />
    return splitBody(body).map((part, n) => {
      if (part.kind === 'text') return <Markdown key={`iss-md-${n}`} text={part.text} />
      const isBusy = taskBusy === `${i.number}-${part.index}`
      const mark = isBusy ? '…' : part.isDone ? '☑' : '☐'
      return chip(table, `iss-task-${i.number}-${part.index}`, fit(`${mark} ${part.text}`, bodyW).trimEnd(), () => void toggleIssueTask($, i, part.index, part.text), {
        color: part.isDone ? 'success' : 'claude',
        dimColor: isBusy,
      })
    })
  }

  if (openNo) {
    const detail = await read($, detailA)
    const i = detail && !detail.error ? detail.issue : null
    const sum = i ? sumOf(i) : undefined
    const hasRel = !!i && (i.isEpic || i.blockedBy.length > 0 || i.blocking.length > 0 || i.prs.length > 0 || !!epicOf(i, items))
    return (
      <Box flexDirection="column" rowGap={1}>
        {chip(table, 'iss-back', t('iss.back'), () => void closeIssue($))}
        {!detail && <Text dimColor>{t('iss.loadingOne', { n: openNo })}</Text>}
        {detail?.error && <Text color="error">{detail.error}</Text>}
        {i &&
          card(
            table,
            'issue-card',
            W,
            { icon: i.state === 'OPEN' ? '○' : '✓', tone: i.state === 'OPEN' ? 'success' : 'merged', text: `#${i.number} ${i.title}` },
            [
              [t('iss.status'), t(i.state === 'OPEN' ? 'iss.stateOpen' : 'iss.stateClosed')],
              [t('iss.author'), i.author || '?'],
              [t('iss.active'), t('iss.ago', { age: ago(i.updatedAt, now) })],
              [t('iss.comments'), String(i.comments)],
              [t('iss.assigned'), i.assignees.join(', ') || '–'],
              [t('iss.labels'), i.labels.map(l => l.name).join(', ') || '–'],
            ],
            undefined,
            [
              ...(i.labels.length > 0 || i.kind ? [<Box key="issue-lbl" width={W - 3}>{labelChips(i)}</Box>] : []),
              ...(sum
                ? [
                    <Box key="issue-sum-box" width={W - 3}>
                      <Text key="issue-sum" italic color="suggestion" wrap="wrap">{t('iss.aiPrefix')} {sum}</Text>
                    </Box>,
                  ]
                : []),
            ],
          )}
        {i && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} width={W}>
            {chip(table, 'iss-claude', t('act.toClaude'), () => void workOnIssue($, i), { variant: 'primary' })}
            {chip(table, 'iss-browser', t('act.browser'), () => void openUrl($, i.url))}
            {chip(table, 'iss-reload', t('common.refresh'), () => void openIssue($, openNo))}
          </Box>
        )}
        {i && hasRel && section('iss-rel', t('iss.relations'), 'permission', relations(i))}
        {i && section('iss-desc', t('iss.description'), 'claude', description(i))}
        {i && (detail?.comments.length ?? 0) > 0 &&
          section(
            'iss-comments',
            t('iss.commentsTitle', { n: i.comments }),
            'suggestion',
            (detail?.comments ?? []).map((c, n) => (
              <Box key={`c-${n}`} flexDirection="column" marginTop={n > 0 ? 1 : 0}>
                <Text>
                  <Text bold color="remember">{c.author}</Text>
                  <Text dimColor> · {t('iss.ago', { age: ago(c.createdAt, now) })}</Text>
                </Text>
                <Markdown text={c.body} />
              </Box>
            )),
          )}
      </Box>
    )
  } else {
    const WEB_LABEL = '↗'
    const WEB_W = WEB_LABEL.length + CHIP_PAD
    const AI_W = t('act.toClaude').length + CHIP_PAD
    const titleW = Math.max(10, inner - 1 - WEB_W - AI_W - 3)
    // Rows a page can take: header 6, list frame 2, pager 2, gaps 2 and some slack make 14; an issue is two rows,
    // a separator and now and then a relations row. Summaries add up to two rows.
    const perPage = S.cfg.settings.issuesPerPage
    const rowH = S.cfg.settings.issueSummaries ? 5.5 : 3.5
    const room = perPage === 'auto' ? Math.max(3, Math.floor(((pane.rows ?? 40) - 14) / rowH)) : perPage
    S.issueRows = room
    const pages = Math.max(1, Math.ceil(items.length / room))
    const page = Math.min(await read($, pageA), pages - 1)
    const shown = items.slice(page * room, page * room + room)
    const total = list?.total ?? items.length
    const stateWord = filters.state === 'open' ? t('iss.stateOpen') : filters.state === 'closed' ? t('iss.stateClosed') : t('iss.totalWord')
    const countText = total > items.length ? t('iss.countOfTotal', { n: items.length, total, state: stateWord }) : t('iss.count', { n: items.length, state: stateWord })
    const isActive = isFiltered(filters)
    const pick = (name: 'state' | 'sort' | 'label' | 'kind' | 'assignee') => (v: string) => void setIssueFilter($, name, v)
    const named = (names: readonly string[]): Option[] => names.map(n => ({ value: `${NAMED}${n}`, label: n }))
    const any: Option = { value: ANY, label: t('iss.any') }

    // Header row: repo and count on the left, switch and refresh on the right; the refresh label shrinks to the icon when it gets tight
    const countW = countText.length + 2
    const sumW = t('set.aiSummary').length + 4
    const isTight = sumW + 1 + t('common.refresh').length + CHIP_PAD + 1 + 3 + 6 + countW > inner
    const refreshLabel = isTight ? '↻' : t('common.refresh')
    const rightW = sumW + 1 + refreshLabel.length + CHIP_PAD
    const isStacked = inner - rightW - 1 < 3 + 6 + countW
    const leftW = isStacked ? inner : inner - rightW - 1
    const repoW = Math.max(4, leftW - 3 - countW)
    const headChips = (
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        {switchBtn(table, 'issue-sum', t('set.aiSummary'), S.cfg.settings.issueSummaries, () => void toggleSummaries($))}
        {chip(table, 'issue-refresh', refreshLabel, () => void refreshIssues($))}
      </Box>
    )

    // Second line of an issue: type, labels, then comments, assignees and age; the tail always stays, the labels give way
    const metaSegs = (i: Issue): Seg[] => {
      const tail = clipSegs([
        ...(i.comments > 0 ? [{ text: `✎ ${i.comments}`, color: 'warning' }] : []),
        ...(i.assignees.length > 0 ? [{ text: `@${i.assignees.join(', @')}`, color: 'remember' }] : []),
        { text: t('iss.ago', { age: ago(i.updatedAt, now) }), dim: true },
      ], bodyW)
      const tailW = tail.reduce((sum, seg) => sum + seg.text.length, 0) + 2 * (tail.length - 1)
      const head = clipSegs([
        ...(i.kind ? [{ text: `[${i.kind}]`, color: 'permission', bold: true }] : []),
        ...i.labels.map(l => ({ text: `●${l.name}`, color: `#${l.color}` })),
      ], bodyW - tailW - 2)
      return [...head, ...tail]
    }

    // Relations on one row; whatever does not fit is left out
    const relLine = (i: Issue) => {
      const epic = epicOf(i, items)
      const kids = i.isEpic ? childrenOf(i.number, items) : []
      const total = Math.max(i.subTotal, kids.length, i.children.length)
      const done = Math.min(i.subDone, total)
      type Rel = { key: string; text: string; color?: Color; dim?: boolean; open?: number }
      const rels: Rel[] = [
        ...(epic ? [{ key: `ep-btn-${i.number}`, text: `◆ #${epic.number}${epic.title ? ` ${epic.title}` : ''}`, color: 'claude' as Color, open: epic.number }] : []),
        ...(i.isEpic && total > 0 ? [{ key: `epb-${i.number}`, text: `${bar(done, total, 6)} ${done}/${total}`, color: (done === total ? 'success' : 'claude') as Color }] : []),
        ...i.blockedBy.map((r, n) => ({
          key: `bb-${i.number}-${r.number}`, text: `${n === 0 ? `${t('iss.relBlockedBy')} ` : ''}#${r.number}${r.state === 'CLOSED' ? ' ✓' : ''}`,
          color: (r.state === 'CLOSED' ? 'success' : 'error') as Color, open: r.number,
        })),
        ...i.blocking.map((r, n) => ({ key: `bl-${i.number}-${r.number}`, text: `${n === 0 ? `${t('iss.relBlocks')} ` : ''}#${r.number}`, color: 'warning' as Color, open: r.number })),
        ...i.prs.map(pr => ({
          key: `pr-${i.number}-${pr.number}`,
          text: `⇄ #${pr.number} (${t(pr.state === 'OPEN' ? 'iss.prOpen' : pr.state === 'MERGED' ? 'iss.prMerged' : 'iss.prClosed')})`,
          color: (pr.state === 'MERGED' ? 'merged' : pr.state === 'OPEN' ? 'success' : 'inactive') as Color,
        })),
      ]
      const out: Array<Rel & { shown: string }> = []
      let used = 0
      for (const r of rels) {
        const room = bodyW - used - (out.length > 0 ? 2 : 0)
        if (room < 6) break
        const shown = fit(r.text, Math.min(room, r.text.length)).trimEnd()
        out.push({ ...r, shown })
        used += shown.length + (out.length > 1 ? 2 : 0)
      }
      if (out.length === 0) return null
      return (
        <Box key={`rel-${i.number}`} flexDirection="row" columnGap={2} width={bodyW}>
          {out.map(r =>
            r.open ? (
              <Button key={r.key} plain label={r.shown} onPress={() => void openIssue($, r.open ?? 0)} />
            ) : (
              <Text key={r.key} color={r.color}>{r.shown}</Text>
            ),
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" rowGap={1}>
        {S.cfg.settings.demo && <Text color="warning">{t('iss.demoNotice')}</Text>}
        <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} width={W}>
          <Box flexDirection="row" columnGap={1} width={inner}>
            <Box flexDirection="row" columnGap={1} width={leftW} flexShrink={0}>
              <Text bold color="claude">◆</Text>
              <Text bold color="claude">{fit(list?.repo ?? t('tab.issues'), repoW).trimEnd()}</Text>
              <Text bold color={items.length > 0 ? 'success' : 'inactive'}>● {countText}</Text>
            </Box>
            {!isStacked && headChips}
          </Box>
          {isStacked && headChips}
          {Input && (
            <Box width={inner}>
              <Input key="issue-search" placeholder={t('iss.searchPlaceholder')} value={query} submitLabel={t('iss.search')} onSubmit={value => void searchIssues($, value)} />
            </Box>
          )}
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={inner}>
            {choice(table, 'issue-f-state', t('iss.status'), filters.state, [
              { value: 'open', label: t('iss.stateOpen') },
              { value: 'closed', label: t('iss.stateClosed') },
              { value: 'all', label: t('iss.stateAll') },
            ], pick('state'))}
            {choice(table, 'issue-f-sort', t('iss.fSort'), filters.sort, [
              { value: 'updated-desc', label: t('iss.sortUpdated') },
              { value: 'updated-asc', label: t('iss.sortUpdatedAsc') },
              { value: 'created-desc', label: t('iss.sortNewest') },
              { value: 'created-asc', label: t('iss.sortOldest') },
              { value: 'comments-desc', label: t('iss.sortComments') },
            ], pick('sort'))}
            {/* Label and type lists can be long: without a dropdown they would be a wall of buttons */}
            {hasSelect && choice(table, 'issue-f-label', t('iss.fLabel'), filters.label, [any, { value: NO_LABEL, label: t('iss.noLabel') }, ...named(options?.labels ?? [])], pick('label'))}
            {hasSelect && S.hasNativeFields && (options?.kinds.length ?? 0) > 0 &&
              choice(table, 'issue-f-type', t('iss.fType'), filters.kind, [any, ...named(options?.kinds ?? [])], pick('kind'))}
            {choice(table, 'issue-f-assignee', t('iss.fAssignee'), filters.assignee, [
              any,
              { value: 'me', label: t('iss.assigneeMe') },
              { value: 'none', label: t('iss.assigneeNone') },
            ], pick('assignee'))}
            {isActive && chip(table, 'issue-reset', t('iss.resetFilters'), () => void resetIssueFilters($), { variant: 'primary', color: 'warning' })}
          </Box>
        </Box>
        {list === null && <Text dimColor>{t('common.loading')}</Text>}
        {list?.problem && <Text color="warning">{ghProblemText(list.problem, list.retryAt)}</Text>}
        {list?.error && <Text color="error">{list.error}</Text>}
        {list?.isCapped && <Text color="warning">{t('iss.capped')}</Text>}
        {list && !list.problem && !list.error && !list.isLoading && items.length === 0 && <Text dimColor>{t(isActive || query ? 'iss.noneFiltered' : 'iss.none')}</Text>}
        {items.length > 0 && (
          <Box flexDirection="column" borderStyle="round" paddingX={1} width={W}>
            {shown.map((i, n) => {
              const sum = sumOf(i)
              const meta = metaSegs(i)
              return (
                <Box key={`issue-${i.number}`} flexDirection="column" width={inner}>
                  {n > 0 && <Text dimColor>{'╌'.repeat(inner)}</Text>}
                  <Box flexDirection="row" columnGap={1} width={inner}>
                    <Box width={1} flexShrink={0}>
                      <Text bold color={i.state === 'OPEN' ? 'success' : 'merged'}>{i.state === 'OPEN' ? '○' : '✓'}</Text>
                    </Box>
                    <Box width={titleW} flexShrink={0}>
                      <Button key={`issue-open-${i.number}`} plain label={fit(`#${i.number} ${i.title}`, titleW).trimEnd()} onPress={() => void openIssue($, i.number)} />
                    </Box>
                    <Box width={WEB_W} flexShrink={0}>
                      {chip(table, `issue-web-${i.number}`, WEB_LABEL, () => void openUrl($, i.url))}
                    </Box>
                    <Box width={AI_W} flexShrink={0}>
                      {chip(table, `issue-ai-${i.number}`, t('act.toClaude'), () => void workOnIssue($, i), { variant: 'primary' })}
                    </Box>
                  </Box>
                  <Box flexDirection="column" paddingLeft={2} width={inner}>
                    {(sum || S.cfg.settings.issueSummaries) && (
                      <Box width={bodyW}>
                        <Text italic color="suggestion" wrap="wrap">{fit(sum ?? t('iss.summarizing'), 2 * bodyW - 2).trimEnd()}</Text>
                      </Box>
                    )}
                    <Box flexDirection="row" columnGap={2} width={bodyW}>
                      {meta.map((seg, k) => (
                        <Text key={`meta-${i.number}-${k}`} color={seg.color as Color | undefined} bold={seg.bold} dimColor={seg.dim}>{seg.text}</Text>
                      ))}
                    </Box>
                    {relLine(i)}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
        {(pages > 1 || list?.isLoading || total > items.length) && items.length > 0 && (
          <Box flexDirection="column" width={W}>
            {pages > 1 && (
              <Box flexDirection="row" flexWrap="wrap" columnGap={1} width={W}>
                {chip(table, 'iss-prev', t('iss.prev'), () => void setIssuePage($, page - 1, room), { dimColor: page === 0 })}
                {pageNumbers(page, pages).map((n, k) =>
                  n === '…' ? (
                    <Text key={`iss-gap-${k}`} dimColor>…</Text>
                  ) : (
                    chip(table, `iss-page-${n}`, String(n + 1), () => void setIssuePage($, n, room), { variant: n === page ? 'primary' : 'secondary' })
                  ),
                )}
                {chip(table, 'iss-next', t('iss.next'), () => void setIssuePage($, Math.min(pages - 1, page + 1), room), { dimColor: page === pages - 1 })}
              </Box>
            )}
            <Text dimColor>
              {shown.length > 0 ? t('iss.range', { from: page * room + 1, to: page * room + shown.length, n: items.length }) : ''}
              {total > items.length ? t('iss.atGithub', { total }) : ''}
              {list?.isLoading ? ` · ${t('iss.loadingMore')}` : ''}
            </Text>
          </Box>
        )}
      </Box>
    )
  }
}
