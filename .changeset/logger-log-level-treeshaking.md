---
"@tailor-platform/sdk": minor
---

`logLevel` now also controls `logger.*` calls (from `@tailor-platform/sdk/runtime`) in bundled functions, in addition to `console.*`. `logger.debug`/`logger.info`/`logger.warn`/`logger.error` are dropped at the same thresholds as their `console` counterparts.
