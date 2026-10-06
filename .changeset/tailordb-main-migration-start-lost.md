---
"@tailor-platform/sdk": patch
---

When `tailor deploy` loses the response to starting a TailorDB migration script that exports `main`, it now waits for the migration that the platform started instead of removing it and rolling the schema back while it runs.
