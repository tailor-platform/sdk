---
"@tailor-platform/sdk": minor
---

These state-changing commands now print a JSON result on stdout under `--json` instead of leaving it empty: `authconnection delete`, `authconnection revoke`, `organization folder delete`, `secret create`, `secret update`, `secret delete`, `secret vault delete`, `workspace delete`, `workspace restore`, `workspace user remove`, `tailordb truncate`, `tailordb migration set`, `tailordb migration rebaseline`, `tailordb migration sync`, and `tailordb migration generate`. Each result carries the same `changed` boolean as the other commands: for example, `tailordb migration set` to the current checkpoint and `tailordb migration generate` with no schema differences report `false`. Under `--json`, `tailordb migration generate` and `tailordb migration script` no longer open the file they create in the editor set by `VISUAL` or `EDITOR`, which would otherwise write to the same stdout. Output without `--json` is unchanged.
