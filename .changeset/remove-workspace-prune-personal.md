---
"@tailor-platform/sdk": minor
---

**Breaking change**: `tailor workspace prune` no longer accepts `--personal`. Every workspace now belongs to an organization, so there are no workspaces outside an organization and folder for it to select. Remove `--personal` from your prune commands and name the locations to sweep with `--organization-root` or `--folder-id`.
