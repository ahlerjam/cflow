# slice: getting started

A short guide for people. The [README](README.md) explains every flow in detail, with diagrams, test results and sources.

## What slice does for you

You describe what you want in the Claude Code chat. slice asks the questions a good product owner would ask, writes a plan, and then builds it without you: one feature after another, each one proven by running it. The finished work lands on an agent branch. You decide what goes to your main branch.

## Five minutes to the first run

1. Install: `/plugin install slice@cflow`.
2. Open your repo in Claude Code and write: **"set up slice"** (or "richte slice in diesem Repo ein").
3. Answer the few setup questions. Allow writing to `.claude/` when Claude asks.
4. Write what you want, in plain words: **"Build me a page where I track when my plants need water."**
5. Answer the interview. Confirm the summary.
6. Pick **Start now** (or **Start in the cloud**).
7. Do something else. You get one chat line when it is done, and the report in the changelog.

## The sentences you need

| Write | What happens |
| --- | --- |
| "Build …", "Add …", "Fix …" | slice plans it with you, then asks whether to start |
| "Show my plans" | all plans with their state |
| "Start plan `<id>`" | runs a parked plan here |
| "Start plan `<id>` in the cloud" | runs it in a cloud session |
| "How far is the run?" | features done of total |
| "Stop the run" | stops; "start plan `<id>`" later resumes |
| "Plan decision D2: …" | turns an open question into a new plan |

No slash commands needed. `/slice:setup`, `/slice:shape` and `/slice:run` exist as a back door.

## What slice takes care of

- **It never touches your main branch or your checkout.** Work happens in its own worktrees and branches; you merge from the agent branch when you want.
- **Done means proven.** Every feature has steps a user would do; the builder runs them against the real app. Screens are checked in a headless browser, and Claude Code's `/verify` checks them again in a fresh session.
- **Clean code over clever code.** The builder follows rules against AI slop: comments only for a reason the code cannot show, no abstraction without a second use, no swallowed errors, no tests changed to pass, no dead code, no extra documentation files. At the end it runs `/simplify` and `/code-review` on its own diff.
- **Architecture records only when they matter.** For a new app beyond a few files, setup proposes `docs/adr/0001-architecture.md` (vertical slices by default). Later decisions get an ADR only when they are costly to reverse and had real alternatives; small apps just name the stack in the README.
- **The right model for the size.** Small changes are built by Sonnet, everything bigger by Opus, and large plans (a new app, architecture decisions or 8+ features) by Opus with an Opus advisor. In a test Sonnet matched Opus on a small tool at 40 % lower cost and fell behind on a larger web app; the advisor on large plans is not measured yet.
- **It never stops to ask.** A missing key or a question only you can answer becomes a reversible interim solution and a numbered decision (D1, D2, …). Finished features are merged anyway.
- **It keeps your secrets out.** Builders run sandboxed, may not push, publish or read credential files, and never see your changelog.

## Which check runs when

| Check | When |
| --- | --- |
| The feature's E2E steps | every feature, before its commit; on start and after a resume the finished features first |
| `/simplify` | once, when all features pass; E2E runs again afterwards |
| `/code-review` | once, on the plan's diff (`/code-review medium <base>..HEAD`), then checked against the spec |
| `/security-review` | only when the diff touches sign-in, secrets, network input or user input |
| Screenshots judged by `taste` | at the end, for features with screens, at 360 and 1280 px |
| `/verify` acceptance | after the builder, in a fresh session, for every plan, including the unhappy paths; this is Claude Code's built-in `/verify` |
| Your repo's `verify` skill | switched off in runs; the builder only reads its recipe |
| The test command | before every merge, on the run branch |

The cookbooks in `skills/practices/references/` load when needed: the planner loads the work-item rules, the cookbook for the project type and, for a new app, the architecture rules; the builder loads the code rules and the same cookbook at start and again after a resume or compaction.

Costs: each run reports what the builder and the acceptance spent. There is no limit; the interview runs in your own session and is not counted.

## Tips

- **Cloud sessions: use auto mode.** A cloud session that waits for a permission answer stands still until you look. slice starts cloud sessions with `--permission-mode auto`; if your session still shows another mode in its mode menu, switch it to **Auto**. When you work in the web chat directly, pick Auto when you create the session. Auto appears only when your organization and the model allow it.
- **Long cloud runs:** set `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` in your cloud environment's variables (for example 3600000 and 7200000), so a long builder is not cut short.
- **Library docs:** the builder looks up every library in Context7 before it writes code against it. Without your own Context7 server, slice brings one; set `CONTEXT7_API_KEY` (locally and in the cloud environment) for higher rate limits.
- **Keys and secrets:** say in the interview which services the work needs. Locally, put the values in `.env` (or list such files in `.worktreeinclude`); in the cloud, set them as environment variables of the cloud environment. Missing keys are no blocker; the builder uses a fake and tells you.
- **Push your branch before a cloud start.** The cloud clones your current branch from GitHub.
- **Be concrete in the interview.** Exact texts, number formats and edge cases you care about go straight into the test steps. "You decide" is fine for single questions.
- **Record a run recipe once.** Run Claude Code's `/verify` on a small change; builders then start your app the recorded way.
- **Small fixes are cheap.** For a one-place change slice asks at most six questions.
- **Look at the plan before starting big work.** "Show my plans" and the plan files under `.slice/plans/<id>/` on the agent branch show exactly what will be built.

## When something goes wrong

| You see | Do |
| --- | --- |
| Setup stops: `.claude/` not writable | allow writing to `.claude/` or create the two files it names |
| "Halted" in the changelog | read the reason; fix it or "start plan `<id>`" to resume |
| A decision D<n> | answer with "plan decision D<n>: …" |
| No cloud link, a paste line instead | run that line in your terminal in the repo |
| Cloud session waits for a permission | switch its mode to Auto, then answer once |
