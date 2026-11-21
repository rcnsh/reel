# The page-load test allows for Chrome's own retry

`tests/server.test.ts` serves a page whose module fails in each way `openPage` (`cli/renderer.ts`) reloads for, and counts the requests. Chrome retries a dropped connection once by itself, before `openPage` sees a failure, so the count of requests for the module is a lower bound (`toBeGreaterThanOrEqual(3)` for two failures then a load), not an exact number.
