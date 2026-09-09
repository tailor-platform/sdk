---
"@tailor-platform/sdk": patch
---

Retry `deploy` requests that fail with a raw transport-level disconnect (`ERR_STREAM_PREMATURE_CLOSE`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`) for no-side-effect/idempotent operations, matching the existing retry behavior for equivalent server-side errors. Previously such disconnects surfaced immediately as a fatal `deploy` failure with no retry.
