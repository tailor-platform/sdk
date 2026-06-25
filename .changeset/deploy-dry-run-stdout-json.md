---
"@tailor-platform/sdk": minor
---

Route `deploy --dry-run` plan diff output to stdout so CI pipelines can capture it cleanly without `2>&1`. Add `--json` / `-j` support to `deploy`: dry-run outputs `{ summary, changes, warnings, conflicts }` and apply outputs `{ summary, status: "applied" }` to stdout for machine-readable consumption. The `warnings` array includes unmanaged resources and skipped secrets; the `conflicts` array lists owner conflicts.
