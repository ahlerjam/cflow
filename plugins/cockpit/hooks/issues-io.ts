import { atom, read, update } from 'claude-code'

import type { Issue, IssueList, IssueOptions } from '../types'
import { cleanQuery, isIssueRef, issuePrompt } from './ci'
import { currentRepo, ghPath, ghReady, note, runGh, setSetting, toast } from './core'
import { demoIssues } from './demo-data'
import { ANY, DEFAULT_FILTERS, ISSUE_PAGE_MAX, NAMED, cleanSummary, detailQuery, filterDemo, isFieldError, isSearchCapError, listQuery, normalizeFilters, optionsQuery, parseDetail, parseListPage, parseOptions, searchString, summaryKey, summaryPrompt, summarySystem } from './issues'
import type { IssueFilters } from './issues'
import { t } from './i18n'
import { S, SEARCH_CAP, SUMMARY_INDEX, SUMMARY_KEEP } from './state'
import type { Eng } from './state'

// Declared in every file that reads them: the mod loader only finds the source in a const of its own file.
const detailA = atom({ plugin: 'cockpit', key: 'issueDetail' } as const, null)
const issuesA = atom({ plugin: 'cockpit', key: 'issues' } as const, null)
const pageA = atom({ plugin: 'cockpit', key: 'issuePage' } as const, 0)
const stateA = atom({ plugin: 'cockpit', key: 'issueState' } as const, 'open')
const sortA = atom({ plugin: 'cockpit', key: 'issueSort' } as const, 'updated-desc')
const labelA = atom({ plugin: 'cockpit', key: 'issueLabel' } as const, 'any')
const kindA = atom({ plugin: 'cockpit', key: 'issueKind' } as const, 'any')
const assigneeA = atom({ plugin: 'cockpit', key: 'issueAssignee' } as const, 'any')
const optionsA = atom({ plugin: 'cockpit', key: 'issueOptions' } as const, null)
const openIssueA = atom({ plugin: 'cockpit', key: 'openIssue' } as const, 0)
const queryA = atom({ plugin: 'cockpit', key: 'issueQuery' } as const, '')
const summariesA = atom({ plugin: 'cockpit', key: 'summaries' } as const, {})

// Runs the query with issue types and sub-issues; if GitHub does not know those fields, once more without them
// and without them for the rest of the session
async function queryGh($: Eng, bin: string, args: (isNative: boolean) => string[], opts: { cwd?: string; timeoutMs: number }) {
  const res = await runGh($, bin, args(S.hasNativeFields), opts)
  if (res.exitCode !== 0 && S.hasNativeFields && isFieldError(`${res.stderr}\n${res.stdout}`)) {
    S.hasNativeFields = false
    return runGh($, bin, args(false), opts)
  }
  return res
}

async function readFilters($: Eng): Promise<IssueFilters> {
  return normalizeFilters({
    state: await read($, stateA),
    sort: await read($, sortA),
    label: await read($, labelA),
    kind: await read($, kindA),
    assignee: await read($, assigneeA),
  })
}

async function writeFilters($: Eng, f: IssueFilters): Promise<void> {
  await update($, stateA, () => f.state)
  await update($, sortA, () => f.sort)
  await update($, labelA, () => f.label)
  await update($, kindA, () => f.kind)
  await update($, assigneeA, () => f.assignee)
}

// A label or type picked in another repo is not offered here: back to "any"
async function storeOptions($: Eng, options: IssueOptions): Promise<void> {
  await update($, optionsA, () => options)
  const f = await readFilters($)
  const isKnown = (value: string, names: readonly string[]) => value === ANY || value === 'none' || (value.startsWith(NAMED) && names.includes(value.slice(NAMED.length)))
  await writeFilters($, { ...f, label: isKnown(f.label, options.labels) ? f.label : ANY, kind: isKnown(f.kind, options.kinds) ? f.kind : ANY })
}

// Once per repo and session; a failed fetch is retried with the next refresh
async function loadOptions($: Eng, bin: string, repo: string, cwd: string): Promise<IssueOptions> {
  const cached = await read($, optionsA)
  if (cached?.repo === repo) return cached
  const [owner, name] = repo.split('/')
  try {
    const res = await queryGh(
      $, bin,
      isNative => ['api', 'graphql', '-f', `query=${optionsQuery(isNative)}`, '-f', `owner=${owner ?? ''}`, '-f', `name=${name ?? ''}`],
      { cwd, timeoutMs: 20_000 },
    )
    if (res.exitCode === 0) {
      const options = parseOptions(res.stdout, repo)
      await storeOptions($, options)
      return options
    }
  } catch {
    // the list still loads, only the pickers stay empty
  }
  return { repo, labels: [], kinds: [] }
}

// isMore appends the next issues behind the loaded ones; otherwise reload from page 1
export async function refreshIssues($: Eng, isMore = false): Promise<void> {
  const now = await $.clock.now()
  if (!isMore) await update($, pageA, () => 0)
  if (S.cfg.settings.demo) {
    const demo = demoIssues(now)
    const kinds = demo.list.items.map(i => i.kind).filter((k): k is string => !!k)
    await storeOptions($, { repo: demo.list.repo ?? '', labels: [...new Set(demo.list.items.flatMap(i => i.labels.map(l => l.name)))], kinds: [...new Set(kinds)] })
    const items = filterDemo(demo.list.items, await readFilters($))
    await update($, issuesA, () => ({ ...demo.list, items, total: items.length }))
    await update($, summariesA, m => ({ ...m, ...demo.summaries }))
    return
  }
  const before = isMore ? await read($, issuesA) : null
  const after = before?.cursor ?? null
  if (isMore && !after) return
  const here = await currentRepo($)
  const ready = await ghReady($)
  // If loading more fails, what is already loaded stays
  const list: IssueList = { at: now, repo: null, items: before?.items ?? [], total: before?.total ?? 0, cursor: after, error: null, problem: ready.problem ?? (here ? null : 'noRepo'), retryAt: 0, isCapped: before?.isCapped ?? false }
  if (ready.bin && here) {
    list.repo = here.full
    const options = await loadOptions($, ready.bin, here.full, here.root)
    const q = searchString(here.full, cleanQuery(await read($, queryA)), await readFilters($), options)
    try {
      const res = await queryGh(
        $, ready.bin,
        isNative => [
          'api', 'graphql', '-f', `query=${listQuery(isNative)}`, '-f', `q=${q}`,
          '-F', `n=${Math.min(ISSUE_PAGE_MAX, Math.max(1, S.cfg.settings.issueLimit))}`,
          ...(after ? ['-f', `after=${after}`] : []),
        ],
        { cwd: here.root, timeoutMs: 20_000 },
      )
      if (res.exitCode === 0) {
        const got = parseListPage(res.stdout)
        // Between two requests an issue can move forward, so skip duplicates when appending
        const old = before?.items ?? []
        list.items = [...old, ...got.items.filter(i => !old.some(o => o.number === i.number))]
        list.total = got.total
        list.cursor = list.items.length >= SEARCH_CAP ? null : got.cursor
        list.isCapped = got.total > SEARCH_CAP
      } else if (after && isSearchCapError(`${res.stderr}\n${res.stdout}`)) {
        list.cursor = null
        list.isCapped = true
      } else list.error = res.stderr.trim().slice(0, 160)
    } catch (err) {
      list.error = String(err).slice(0, 160)
    }
  }
  if (!list.problem && S.rateUntil > now) {
    list.problem = 'rate'
    list.error = null
  }
  list.retryAt = list.problem === 'rate' ? S.rateUntil : 0
  await update($, issuesA, () => list)
  // Loading more is followed by setIssuePage, which knows the rows that are visible then
  if (!isMore && list.repo) void summarize($, list.repo, list.items.slice(0, S.issueRows), ++S.sumGen)
}

// store.keys() has no documented order, so the age is tracked in an index key (oldest first).
// Summary keys missing from the index (older versions) count as the oldest.
async function pruneSummaries($: Eng, fresh: string): Promise<void> {
  const raw = (await $.store.get(SUMMARY_INDEX)) as unknown
  const index = Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
  const keys = (await $.store.keys()).filter(k => k.startsWith('sum:'))
  const known = new Set(keys)
  const order = [...keys.filter(k => k !== fresh && !index.includes(k)), ...index.filter(k => known.has(k) && k !== fresh), fresh]
  const drop = order.slice(0, Math.max(0, order.length - SUMMARY_KEEP))
  for (const k of drop) await $.store.delete(k)
  await $.store.set(SUMMARY_INDEX, order.slice(drop.length))
}

// One at a time for the rows given (the caller passes the visible ones); a newer generation stops an older loop.
// Cached per locale and state (updatedAt) so each issue costs usage only once.
export async function summarize($: Eng, repo: string, items: readonly Issue[], gen: number = S.sumGen): Promise<void> {
  for (const issue of items) {
    if (!S.cfg.settings.issueSummaries || gen !== S.sumGen) return
    const key = summaryKey(repo, issue, S.locale)
    if ((await read($, summariesA))[key]) continue
    let text = (await $.store.get(key)) as string | undefined
    if (!text) {
      try {
        const res = await $.model.complete({
          model: S.cfg.settings.summaryModel,
          system: summarySystem(S.locale),
          prompt: summaryPrompt(issue),
          maxTokens: 120,
          timeoutMs: 20_000,
        })
        if (!res.isAnswered) continue
        text = cleanSummary(res.text)
        if (gen !== S.sumGen) return
        await $.store.set(key, text)
        await pruneSummaries($, key)
      } catch {
        continue
      }
    }
    const done = text
    await update($, summariesA, m => ({ ...m, [key]: done }))
  }
}

export async function openIssue($: Eng, number: number): Promise<void> {
  await update($, openIssueA, () => number)
  await update($, detailA, () => null)
  if (S.cfg.settings.demo) {
    const demo = demoIssues(await $.clock.now())
    const issue = demo.list.items.find(i => i.number === number)
    await update($, detailA, () =>
      issue
        ? { issue, comments: demo.comments[number] ?? [], error: null }
        : { ...parseDetail('{}'), error: t('iss.demoMissing', { n: number }) },
    )
    return
  }
  const list = await read($, issuesA)
  const bin = await ghPath($)
  const repo = list?.repo
  if (!bin || !repo) return
  const [owner, name] = repo.split('/')
  try {
    const res = await queryGh(
      $, bin,
      isNative => ['api', 'graphql', '-f', `query=${detailQuery(isNative)}`, '-f', `owner=${owner ?? ''}`, '-f', `name=${name ?? ''}`, '-F', `number=${number}`],
      { timeoutMs: 20_000 },
    )
    const detail = res.exitCode === 0 ? parseDetail(res.stdout) : { ...parseDetail('{}'), error: res.stderr.trim().slice(0, 160) }
    await update($, detailA, () => detail)
    if (!detail.error) void summarize($, repo, [detail.issue], S.sumGen)
  } catch (err) {
    await update($, detailA, () => ({ ...parseDetail('{}'), error: String(err).slice(0, 160) }))
  }
}

export async function workOnIssue($: Eng, issue: Issue): Promise<void> {
  if (S.cfg.settings.demo) {
    toast($, t('iss.demoHandOver', { n: issue.number }))
    return
  }
  await handOver($, issue)
}

export async function toggleSummaries($: Eng): Promise<void> {
  await setSetting($, 'issueSummaries', !S.cfg.settings.issueSummaries)
  if (!S.cfg.settings.issueSummaries) {
    S.sumGen++
    return
  }
  if (!(await $.store.get('sumNoticeSeen'))) {
    await $.store.set('sumNoticeSeen', true)
    await note($, t('iss.sumNotice'))
  }
  await refreshIssues($)
}

export async function setSummaryModel($: Eng, model: string): Promise<void> {
  await setSetting($, 'summaryModel', model === 'sonnet' ? 'sonnet' : 'haiku')
}

export async function closeIssue($: Eng): Promise<void> {
  await update($, openIssueA, () => 0)
  await update($, detailA, () => null)
}

export async function handOver($: Eng, issue: Issue): Promise<void> {
  const list = await read($, issuesA)
  if (!list?.repo) return
  if (!isIssueRef(list.repo, issue.number)) {
    toast($, t('iss.badRef'))
    return
  }
  // Appended, so a draft already typed stays
  const draft = (await $.prompt.read()).text
  const text = `${draft && !/\s$/.test(draft) ? ' ' : ''}${issuePrompt(list.repo, issue)}`
  const r = await $.prompt.fill({ text, mode: draft ? 'append' : 'replace' })
  toast($, t(r.isFilled ? 'iss.handedOver' : 'iss.inputBusy', { n: issue.number }))
}

// The pane clamps the page to the existing ones; rows is how many it shows per page, for the summaries
export async function setIssuePage($: Eng, page: number, rows: number = S.issueRows): Promise<void> {
  const at = Math.max(0, page)
  await update($, pageA, () => at)
  const list = await read($, issuesA)
  if (list?.repo && !S.cfg.settings.demo) void summarize($, list.repo, list.items.slice(at * rows, at * rows + rows), ++S.sumGen)
}

export async function searchIssues($: Eng, value: string): Promise<void> {
  await update($, queryA, () => value)
  await refreshIssues($)
}

export async function setIssueFilter($: Eng, name: keyof IssueFilters, value: string): Promise<void> {
  await writeFilters($, normalizeFilters({ ...(await readFilters($)), [name]: value }))
  await refreshIssues($)
}

export async function resetIssueFilters($: Eng): Promise<void> {
  await writeFilters($, DEFAULT_FILTERS)
  await refreshIssues($)
}
