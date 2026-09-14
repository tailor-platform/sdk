---
"@tailor-platform/sdk": minor
---

Add `tailor workspace prune` to delete stale temporary workspaces, such as the ones left behind by CI runs, preview deployments, or interrupted local e2e runs.

In name-and-age mode, a workspace is deleted only when its whole name matches a `--name` regular expression and it was created at least `--older-than` ago. Use `--organization-root <id>` for workspaces directly under an organization, `--folder-id <id>` for workspaces in a folder, or `--personal` for workspaces belonging to no organization and no folder. Organization roots and folders can be repeated, and all locations combine as a union. Locations are read only from the command line; without a location, this mode considers every visible workspace.

Use `--exclude` to keep named workspaces. Delete-protected workspaces are always kept, the command aborts without deleting anything when more workspaces match than `--limit` allows or when a location option resolves to an empty value, and `--dry-run` lists the candidates first. `--older-than 0s` requires an explicit location.

```bash
tailor workspace prune --name 'e2e-ws-.*' --older-than 24h --dry-run
tailor workspace prune --name 'e2e-ws-.*' --older-than 24h --yes
```
