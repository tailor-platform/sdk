---
"@tailor-platform/sdk": minor
---

Add `tailor workspace prune` to delete stale temporary workspaces, such as the ones left behind by CI runs, preview deployments, or interrupted local e2e runs.

A workspace is deleted only when its whole name matches a `--name` regular expression and it was created at least `--older-than` ago, optionally scoped with `--organization-id` / `--folder-id` and kept with `--exclude`. Delete-protected workspaces are always kept, the command aborts without deleting anything when more workspaces match than `--limit` allows or when a scope option resolves to an empty value, and `--dry-run` lists the candidates first.

```bash
tailor workspace prune --name 'e2e-ws-.*' --older-than 24h --dry-run
tailor workspace prune --name 'e2e-ws-.*' --older-than 24h --yes
```
