# Work items, features and E2E steps

## Rules
- Title names the outcome a user gets ("Export habits as CSV"), not the activity ("Implement export").
- Every feature states who benefits and why in one sentence; drop features nobody would miss.
- Slice vertically: each feature runs end to end through every layer it needs and is useful on its own. Never split
  by layer (database, backend, UI). Split big features by workflow step, by rule variant, by data variant, or happy
  path first and edge cases after.
- INVEST: independent, negotiable, valuable, estimable, small, testable. Small means it is built and proved within a few
  commits; testable means a pass/fail check exists before building starts.
- Acceptance criteria are Given/When/Then: Given a state, When the user does one thing, Then they observe a result.
  One behaviour per criterion, declarative ("Given a habit with a 3 day streak"), no click-by-click scripts, no
  implementation details in Then.
- E2E steps turn each criterion into something a builder can execute and observe with real data: exact input, exact
  command or action, exact expected output, exit code or screen text. "Works correctly" or "handles errors" is not a
  step.
- Cover the unhappy paths the user would hit: invalid input, empty and very long data, missing or corrupt data,
  repeated actions, undo, permissions. Name the expected message or status.
- Build order: the first feature is the walking skeleton (see `references/architecture.md`); each later feature can be checked
  with only the ones before it.
- Owner decisions (direction, stack, architecture, UX, anything irreversible) are settled in planning or written down
  as an assumption in the summary, never left for the builder to guess.

## Sources
- INVEST: https://www.agilealliance.org/glossary/invest/
- Given/When/Then: https://martinfowler.com/bliki/GivenWhenThen.html, https://cucumber.io/docs/bdd/better-gherkin/
- Splitting stories: https://www.humanizingwork.com/the-humanizing-work-guide-to-splitting-user-stories/
