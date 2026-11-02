# Code rules

## Style
- The repo's existing style and its formatter and linter config win. Without one, use the language's standard tool
  (for example gofmt, rustfmt, ruff, prettier) and add it as a make target or script, not as hand formatting.
- Match the surrounding code: naming, file layout, error handling, test style.

## Against AI slop
- Comments only for a reason the code cannot show. No comments that restate the code, narrate steps or announce the
  change.
- No abstraction, parameter, option or config flag without a second real caller or a stated need (YAGNI).
- Handle errors at system boundaries (input, files, network, processes). Inside, trust your own types and
  invariants; no checks for cases that cannot happen.
- Never swallow an error: log it or return it, and tell the user what to do.
- Search for an existing helper before writing a new one; never copy a block to change one line.
- Tests check behaviour the spec names, not implementation details. Never edit or delete a test to make it pass; no
  tests for impossible cases.
- No dead code, unused exports, commented-out code, placeholder data or TODOs left behind.
- Keep diffs small and on topic; no drive-by refactors.
- Unsure about a library or API: look it up (Context7 or the installed package's docs) instead of guessing.
- Review for correctness against the spec; skip style.

## Sources
- https://code.claude.com/docs/en/best-practices
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- https://martinfowler.com/bliki/Yagni.html
- https://martinfowler.com/articles/practical-test-pyramid.html
- https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
