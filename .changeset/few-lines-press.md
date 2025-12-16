---
"@tailor-platform/sdk": minor
---

CLI changes:

- Replace `--format` with `--json` for all list/detail commands. `--format` is no longer supported.
- Change default table layout for list output and humanize `createdAt` / `updatedAt` in table format (JSON remains ISO strings).
- `workspace list`: hide `updatedAt` in table output and add `--limit=<number>` to cap the number of workspaces shown.

**Breaking:** Scripts or tooling that relied on `--format` or the previous table layout may need to be updated.
