# Architecture

## Walking skeleton
The first feature is a tiny version of the whole system: it starts with one documented command, runs one core path
from input to output through every part the system needs, and is checked by an E2E step. It is production code, not a
prototype; later features grow it.

## Vertical slices
Organize code by feature or request, not by technical layer. Inside a slice coupling and some duplication are fine;
between slices keep them apart. Each slice may pick the structure it needs. Proposed by default for new apps; an
existing codebase keeps its style.

## Decision records
Record decisions that are costly to reverse (stack, storage, architecture style, public interfaces) in
`docs/adr/NNNN-title.md` using MADR: `## Context and Problem Statement`, `## Considered Options`,
`## Decision Outcome` (with `### Consequences`), optionally `## Decision Drivers`. One decision per record; a changed
decision gets a new record that supersedes the old one.

## Sources
- https://jimmybogard.com/vertical-slice-architecture/
- https://adr.github.io/madr/
- Walking skeleton (Cockburn, Freeman and Pryce): no reachable original page was found; the definition above follows
  the common secondary sources.
