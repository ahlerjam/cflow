# Cookbook: HTTP API

## Coverage questions
- Resources and operations; who calls the API and how they authenticate.
- Error format and status codes per error class.
- Lists: size limits, pagination, filters, sort order.
- Retries: which writes must be safe to repeat?
- Versioning and what counts as a breaking change.
- Limits: rate limits, payload size, timeouts.

## Quality bar
- Correct status codes and methods: GET is safe, PUT and DELETE are idempotent.
- Errors as RFC 9457 problem details (`application/problem+json` with `type`, `title`, `status`, `detail`), one
  stable `type` per error class.
- Every list is paginated with a cursor or page token and a maximum page size.
- Repeatable POSTs accept an idempotency key.
- An OpenAPI description ships with the API; breaking changes only with a new version.
- Authorization is checked on every request for the object accessed (broken access control is OWASP's top risk).
- Validate input on the server; no secrets in code or logs.

## E2E approach
Start the server, call it with `curl` (or the client the spec names) with exact requests, and check status, headers
and body literally, including the error cases and a second call of each repeatable write.

## Sources
- https://www.rfc-editor.org/rfc/rfc9457.html
- https://www.rfc-editor.org/rfc/rfc9110.html
- https://google.aip.dev/
- https://opensource.zalando.com/restful-api-guidelines/
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
