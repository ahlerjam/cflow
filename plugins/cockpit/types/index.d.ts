export type CockpitTab = 'sources' | 'actions' | 'issues' | 'settings' | 'help'

export type SourcesView = 'overview' | 'plugins'

// What the overview buttons set: the global default or this folder's deviation
export type SourcesScope = 'global' | 'folder'

export type IssueRef = { number: number; title: string; state: string; url?: string }

export type IssueLabel = { name: string; color: string }

export type Issue = {
  number: number
  title: string
  url: string
  state: string
  author: string
  body: string
  labels: IssueLabel[]
  assignees: string[]
  updatedAt: string
  comments: number
  // Epic: parent from GitHub or "Epic #N" in the text
  parent: IssueRef | null
  epicRef: number | null
  // Issue type from GitHub (null: none or not supported)
  kind: string | null
  isEpic: boolean
  // Native sub-issues, open and closed; empty when GitHub reports none
  children: IssueRef[]
  subTotal: number
  subDone: number
  blockedBy: IssueRef[]
  blocking: IssueRef[]
  prs: IssueRef[]
}

export type IssueComment = { author: string; body: string; createdAt: string }

export type IssueDetail = { issue: Issue; comments: IssueComment[]; error: string | null }

// What stops the GitHub-backed tabs; shown as one localized line
export type GhProblem = 'missing' | 'auth' | 'noRepo' | 'rate'

export type IssueList = {
  at: number
  repo: string | null
  items: Issue[]
  // Total hits on GitHub and the cursor for the next fetch (null: everything loaded)
  total: number
  cursor: string | null
  error: string | null
  problem: GhProblem | null
  // When a rate-limited request may be retried (ms)
  retryAt: number
  // The search runs into GitHub's limit of 1000 results
  isCapped: boolean
}

export type IssueState = 'open' | 'closed' | 'all'
export type IssueSort = 'updated-desc' | 'updated-asc' | 'created-desc' | 'created-asc' | 'comments-desc'
export type IssueAssignee = 'any' | 'me' | 'none'

// Labels and issue types of the repo that the filters offer (the first 100 labels)
export type IssueOptions = { repo: string; labels: string[]; kinds: string[] }

export type CiCheckCount = { passed: number; failed: number; pending: number }

export type CiRun = {
  repo: string
  id: number
  name: string
  status: string
  conclusion: string
  branch: string
  createdAt: string
  startedAt: string
  updatedAt: string
  url: string
  attempt?: number
}

export type CiVm = {
  name: string
  repo: string
  state: string
  size: string
  createdAt: number
  // Name of the job currently running on it (from GitHub), if known
  job: string | null
  jobUrl: string | null
  runId: number
  jobId: number
}

export type ActStep = { number: number; name: string; status: string; conclusion: string; startedAt: string; completedAt: string }

export type ActJob = {
  id: number
  name: string
  status: string
  conclusion: string
  startedAt: string
  completedAt: string
  url: string
  steps: ActStep[]
}

export type ActRunDetail = {
  repo: string
  id: number
  workflow: string
  title: string
  event: string
  branch: string
  sha: string
  status: string
  conclusion: string
  createdAt: string
  startedAt: string
  updatedAt: string
  url: string
  attempt: number
  jobs: ActJob[]
  error: string | null
  isDemo: boolean
}

export type ActLog = {
  repo: string
  jobId: number
  jobName: string
  steps: Array<{ name: string; lines: string[] }>
  error: string | null
  isFailedOnly: boolean
}

export type ActWorkflow = { id: number; name: string; path: string; state: string }

export type ActView = 'runs' | 'runners' | 'workflows'

export type ActOpen = { repo: string; runId: number; jobId: number }

export type CiFleet = {
  // null: neither the pool answer nor the config says
  maxPool: number | null
  maxRunnersPerRepo: number | null
  vms: CiVm[]
  demand: number
}

export type CiPool = {
  mode: string
  ready: number
  busy: number
  demand: number
  normal: number
  large: number
  // VMs per state as the worker counts them (ready, busy, booting …)
  states: Record<string, number>
  // Repos managed by the pool; null while the worker does not report it
  managed: number | null
  // Repos with a VM, open demand or a fresh webhook
  active: number
}

export type CiSnapshot = {
  at: number
  pool: CiPool | null
  // When /health last answered (ms), even without a full CI fetch
  poolAt: number
  poolError: string | null
  repo: string | null
  pr: { number: number; title: string; url: string; checks: CiCheckCount } | null
  runs: CiRun[]
  ghError: string | null
  // Error text per repo of the "All repos" list; one failing repo does not blank the rest
  repoErrors: Record<string, string>
  problem: GhProblem | null
  retryAt: number
  fleet: CiFleet | null
  fleetError: string | null
  isDemo: boolean
}

declare module 'claude-code' {
  interface PluginState {
    cockpit: {
      tab: CockpitTab
      ci: CiSnapshot | null
      configVersion: number
      notice: string
      issues: IssueList | null
      issueQuery: string
      issueState: IssueState
      issueSort: IssueSort
      issueLabel: string
      issueKind: string
      issueAssignee: IssueAssignee
      issueOptions: IssueOptions | null
      sourcesView: SourcesView
      openIssue: number
      issueDetail: IssueDetail | null
      summaries: Record<string, string>
      issuePage: number
      actView: ActView
      actAllRepos: boolean
      actOpen: ActOpen | null
      actRun: ActRunDetail | null
      actJob: number
      actLog: ActLog | null
      actStep: string
      actOnlyErrors: boolean
      actLogLimit: number
      actWorkflows: ActWorkflow[] | null
      actWorkflowFilter: string
      confirm: string
      known: string[]
      grants: string[]
      uses: Record<string, number>
      isPaneOpen: boolean
      isClosed: boolean
      sourcesScope: SourcesScope
      isScopePicked: boolean
    }
  }
}
