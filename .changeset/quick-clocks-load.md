---
"@tailor-platform/sdk": patch
---

Reduce CLI and config-loader startup time: relative times such as "5 minutes ago" no longer load date-fns at startup, and `es-toolkit` helpers are imported from subpaths instead of the package root
