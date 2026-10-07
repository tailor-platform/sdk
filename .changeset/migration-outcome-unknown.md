---
"@tailor-platform/sdk": patch
---

When `tailor deploy` cannot confirm whether a TailorDB migration's `main` script started or finished, it no longer removes the run and rolls back the migration's schema changes while the script may still be running. It reports the outcome as unconfirmed, keeps the namespace in maintenance mode, and explains how to check the run and settle the migration. A later deploy refuses to run the migration again while that run is still executing. While the script runs, the deploy now keeps waiting while the platform is temporarily unavailable instead of giving up.
