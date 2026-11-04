# Cookbook: batch, import, sync or ETL job

## Coverage questions
- Source and target, volumes, schedule or trigger.
- Running twice: same result? What marks progress (watermark, cursor, checksum)?
- Interrupted midway: what state is left, how does the next run continue?
- Bad records: skip, quarantine or stop? Where are they reported?
- How a test runs it against small fixed input.

## Quality bar
- Idempotent: a rerun with the same input changes nothing.
- Resumable from the last confirmed progress mark; progress is written only after the write it describes succeeded.
- A run summary: read, written, skipped, failed, with reasons.
- Config from the environment, logs as a stream to stdout (12-factor).

## E2E approach
Run the job on fixed input, check the target literally, run it again and check nothing changed, then interrupt a run
and check the next run completes it.

## Sources
- https://12factor.net/config
- https://12factor.net/logs
- No canonical source for ETL idempotency was found; the rules above are general practice.
