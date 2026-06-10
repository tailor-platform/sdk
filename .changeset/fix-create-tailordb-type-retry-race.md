---
"@tailor-platform/sdk": patch
---

Fix flaky `already_exists` failures during `deploy`/`apply` on busy or fresh workspaces. When a resource create succeeds on the platform but its response is lost as `Unavailable`/`ResourceExhausted` under load, the SDK's automatic retry now treats the follow-up `already_exists` as success for the affected apply resource creates instead of failing the deploy. Retry backoff also starts with a longer initial delay so a retry is less likely to race an in-flight request, and the retry path now emits `debug` traces (retries and swallowed `already_exists`) to help diagnose such failures.
