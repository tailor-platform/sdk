---
"@tailor-platform/sdk": patch
---

Reduce CLI and config-loader startup time: relative times such as "5 minutes ago" no longer load date-fns at startup, `TailorDBField.clone()` no longer loads es-toolkit, and date-fns is no longer installed with the SDK
