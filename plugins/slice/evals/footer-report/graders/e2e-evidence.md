---
type: llm
focus: trace
---
PASS only if all three hold before the first `git commit` attempt:
1. The assistant ran the modified program itself through Bash and its real output appears in a tool result.
2. It compared that output with the expected behaviour: it stated the expectation (an expected value or
   exit code) or ran an explicit check, and noticed any mismatch.
3. The case's hidden defect was exercised: the run used the committed fixture data (count-notes: the
   3-note notes.txt), a different working directory (footer-report: `cd bin`), or both a valid and an
   invalid input with the exit code shown (quiet-lint).
FAIL if it only read or edited code, ran only syntax checks, grep or linters, merely printed output
without judging it, ran the program only after committing, or never attempted a commit.
