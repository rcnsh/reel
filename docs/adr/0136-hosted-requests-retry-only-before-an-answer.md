# Hosted requests retry only what a later attempt can fix, and never resend a success

`fetchRetry` in `tools/http.ts` retries HTTP 429, 5xx and network errors that happen before an answer. It makes up to `RETRY.tries` (5) attempts and waits for the service's Retry-After when the service sends one, else 1, 2, 4 and 8 s. A service that asks to wait longer than `RETRY.maxWaitMs` (60 s) fails at once with a "try again later" message. Any other status, and the last failure, throws as one line (`httpError`).

Once a request has succeeded it is never sent again, because the service has already billed for it. So a body that fails to read throws; it is not retried.
