// Sample data for CI and Issues (the "Demo" setting), shown in the pane only.
import type { CiRun, CiSnapshot, CiVm, Issue, IssueComment, IssueList } from '../types'
import { t } from './i18n'
import { S } from './state'
import { emptyIssue, epicRefOf, isEpicIssue, summaryKey } from './issues'

export function demoCi(now: number): CiSnapshot {
  const min = (m: number) => new Date(now - m * 60_000).toISOString()
  const run = (id: number, name: string, status: string, conclusion: string, branch: string, startMin: number, endMin: number): CiRun => ({
    repo: 'acme/widgets', id, name, status, conclusion, branch, createdAt: min(startMin + 1), startedAt: min(startMin), updatedAt: min(endMin), url: 'https://github.com/acme/widgets/actions',
  })
  const vm = (name: string, repo: string, state: string, size: string, ageMin: number, job: string | null): CiVm => ({
    name, repo, state, size, createdAt: now - ageMin * 60_000, job,
    jobUrl: job ? `https://github.com/${repo}/actions` : null,
    runId: job ? 1000 + ageMin : 0,
    jobId: job ? 10_000 + ageMin : 0,
  })
  return {
    at: now,
    isDemo: true,
    pool: { mode: 'managed', ready: 2, busy: 5, demand: 1, normal: 4, large: 3, states: { ready: 2, busy: 5 }, managed: 15, active: 4 },
    poolAt: now,
    poolError: null,
    repo: 'acme/widgets',
    pr: { number: 231, title: 'feat(auth): SSO sign-in for multiple tenants', url: 'https://github.com/acme/widgets/pull/231', checks: { passed: 7, failed: 1, pending: 2 } },
    runs: [
      run(9101, 'ci / unit tests', 'in_progress', '', 'feat/sso', 6, 0),
      run(9100, 'ci / lint + typecheck', 'completed', 'success', 'feat/sso', 7, 5),
      run(9099, 'ci / unit tests', 'completed', 'failure', 'feat/sso', 31, 12),
      run(9098, 'deploy / production', 'completed', 'success', 'main', 95, 88),
      run(9097, 'ci / unit tests', 'completed', 'success', 'main', 120, 97),
      run(9096, 'ci / e2e', 'queued', '', 'feat/search', 8, 0),
      run(9095, 'ci / lint + typecheck', 'completed', 'cancelled', 'feat/search', 140, 138),
      run(9094, 'nightly / map tiles', 'completed', 'timed_out', 'main', 600, 540),
      run(9093, 'ci / unit tests', 'completed', 'success', 'feat/ranking', 700, 671),
      run(9092, 'codeql', 'completed', 'skipped', 'main', 720, 720),
    ],
    ghError: null,
    repoErrors: {},
    problem: null,
    retryAt: 0,
    fleet: {
      maxPool: 12,
      maxRunnersPerRepo: 8,
      demand: 1,
      vms: [
        vm('runner-01', 'acme/widgets', 'busy', 'large', 14, 'unit tests'),
        vm('runner-02', 'acme/widgets', 'busy', 'normal', 9, 'lint + typecheck'),
        vm('runner-03', 'acme/widgets', 'busy', 'large', 22, 'e2e'),
        vm('runner-04', 'acme/gadgets', 'busy', 'large', 41, 'compose-smoke'),
        vm('runner-05', 'acme/website', 'busy', 'normal', 5, 'frontend / test'),
        vm('runner-06', 'acme/widgets', 'ready', 'normal', 3, null),
        vm('runner-07', 'acme/gadgets', 'ready', 'large', 63, null),
      ],
    },
    fleetError: null,
  }
}

export function demoIssues(now: number): { list: IssueList; summaries: Record<string, string>; comments: Record<number, IssueComment[]> } {
  const iso = (h: number) => new Date(now - h * 3_600_000).toISOString()
  const repo = 'acme/widgets'
  const url = (n: number) => `https://github.com/${repo}/issues/${n}`
  const label = (name: string, color: string) => ({ name, color })
  const L = {
    epic: label('epic', '3E4B9E'), bug: label('bug', 'D73A4A'), feat: label('enhancement', 'A2EEEF'),
    auth: label('auth', 'FBCA04'), search: label('search', '0E8A16'),
    ci: label('ci', '5319E7'), docs: label('docs', '0075CA'),
  }
  const base = (n: number, title: string, labels: Issue['labels'], h: number, body: string): Issue => ({
    ...emptyIssue(), number: n, title, url: url(n), author: 'alice', body, labels, updatedAt: iso(h),
    epicRef: epicRefOf(title, body), isEpic: isEpicIssue(title, labels),
  })
  const items: Issue[] = [
    { ...base(251, 'Epic: Single sign-on', [L.epic, L.auth], 3, '## Goal\nSign in through the company identity provider.\n\n- [x] #243 Session model\n- [ ] #255 Provider config\n- [ ] #258 Audit log'), subTotal: 3, subDone: 1, comments: 7, assignees: ['alice'] },
    { ...base(248, 'Login fails with SSO', [L.bug, L.auth], 2, 'With more than 5 tenants `list_tenants` times out.\n\nSteps:\n1. Sign in with 6 tenants\n2. Error 504\n\n- [x] Reproduce\n- [ ] Load tenants in batches\n- [ ] Add a regression test'), comments: 2, assignees: ['alice'], prs: [{ number: 312, title: 'fix(auth): load tenants in batches', state: 'OPEN' }], kind: 'Bug' },
    { ...base(255, 'Auth: validate provider config (Epic #251)', [L.auth, L.feat], 6, 'Part of Epic #251. Reject incomplete provider settings at startup.'), blockedBy: [{ number: 243, title: 'Auth: session model', state: 'CLOSED' }], comments: 1 },
    { ...base(258, 'Auth: audit log for sign-ins (Epic #251)', [L.auth], 20, 'After Epic #251, due 07.11.'), blockedBy: [{ number: 255, title: 'Auth: validate provider config', state: 'OPEN' }] },
    { ...base(246, 'Search: add a relevance score to results', [L.feat, L.search], 26, 'Results should carry a score so clients can sort by relevance.'), comments: 2, kind: 'Feature' },
    { ...base(239, 'CI: unit tests on large runners take over 30 min', [L.ci], 48, 'Since the matrix added Python 3.13 the run takes twice as long.'), blocking: [{ number: 248, title: 'Login fails with SSO', state: 'OPEN' }], assignees: ['bob'], kind: 'Task' },
    { ...base(230, 'Docs: update the deploy guide for the new server', [L.docs], 120, 'The steps for the map service are missing.'), kind: 'Task' },
  ]
  const summaries: Record<string, string> = {
    251: 'Umbrella epic: sign-in should go through the company identity provider.',
    248: 'Sign-in with more than five tenants times out and has to load them in batches.',
    255: 'Incomplete provider settings should be rejected at startup instead of failing at sign-in.',
    258: 'Sign-ins should be written to an audit log; waits on the provider config.',
    246: 'Search results should carry a relevance score for sorting.',
    239: 'The unit test matrix on the large runners is too slow and holds up other issues.',
    230: 'The deploy guide for the server lacks the steps for the map service.',
  }
  const comments: Record<number, IssueComment[]> = {
    248: [
      { author: 'alice', body: 'Reproduced with 6 tenants.', createdAt: iso(30) },
      { author: 'bob', body: 'Each tenant takes about 9 s to load, the gateway gives up after 45 s.', createdAt: iso(4) },
    ],
  }
  const demoRepo = t('iss.demoRepo', { repo })
  return {
    list: { at: now, repo: demoRepo, items, total: items.length, cursor: null, error: null, problem: null, retryAt: 0, isCapped: false, isLoading: false },
    summaries: Object.fromEntries(items.map(i => [summaryKey(demoRepo, i, S.locale), summaries[i.number] ?? ''])),
    comments,
  }
}
