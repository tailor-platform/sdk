---
"@tailor-platform/sdk": patch
---

When `tailor deploy` loses the response to starting a TailorDB migration that runs in one transaction (a script that exports `main`, or `steps` with a single step), it now waits for the migration that the platform started instead of removing it and rolling the schema back while it runs.
