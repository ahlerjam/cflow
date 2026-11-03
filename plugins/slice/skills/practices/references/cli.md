# Cookbook: command line tool

## Coverage questions
- Commands and flags; which are the everyday ones? Interactive prompts at all, and what replaces them without a TTY?
- Output for humans and for scripts (`--json` or plain columns)? Colors, and when they are off?
- Exit codes per error class; which errors go to stderr with what message?
- Where data and config live, how a test points the tool at a fresh location, how a test fixes the current time.
- Platforms and install: which shell or runtime is guaranteed, which tools must not be assumed (GNU vs BSD)?

## Quality bar
- `--help` and `--version`; help shows usage and one example per command.
- stdout for results, stderr for errors and progress. Exit 0 on success, non-zero on failure, documented per class.
- Works without a TTY: flags instead of prompts; prompt only when stdin is a TTY, with a flag to skip it.
- Colors only on a TTY and never when `NO_COLOR` is set.
- Destructive commands confirm or need `--force`.
- POSIX conventions: short options are one letter, `--` ends options.

## E2E approach
Each step runs the tool with exact arguments in a fresh data directory and checks stdout, stderr and the exit code
literally. Pipe output to test the non-TTY path; for the TTY path use `script -q /dev/null <cmd>` (macOS) or `script -q -c '<cmd>' /dev/null` (Linux) where the sandbox
allows a pseudo-terminal.

## Sources
- https://clig.dev/
- https://no-color.org/
- https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html
