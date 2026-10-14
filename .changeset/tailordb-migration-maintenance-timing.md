---
"@tailor-platform/sdk": minor
---

Show how long `tailor deploy` keeps tables in maintenance mode while it applies TailorDB migrations. Deploy now tells waiting for a migration job to start apart from the script running: it reports when the script starts running, how long it waited and ran, and a summary of the whole maintenance window by phase. `tailor deploy --json` returns the same breakdown under `tailordbMaintenance`. Each migration job now logs `[tailor-sdk] migration script started` before the script runs.
