# Cookbook: library or SDK

## Coverage questions
- Who imports it, in which language versions and environments?
- The public API: which names are public, which are internal?
- Errors: exceptions, error values or result types; what callers can rely on.
- Compatibility promise and versioning.

## Quality bar
- Semantic versioning: a breaking change of the public API raises MAJOR.
- Every public name is documented with one runnable example.
- A changelog for people, grouped Added, Changed, Fixed, Removed.
- No global state and no I/O at import time.

## E2E approach
A small consumer script or example project imports the built package (not the source tree) and runs the documented
examples; its output is checked literally.

## Sources
- https://semver.org/
- https://keepachangelog.com/en/1.1.0/
