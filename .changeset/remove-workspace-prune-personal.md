---
"@tailor-platform/sdk": minor
---

**Breaking change**: `tailor workspace prune` no longer accepts `--personal`. Every workspace now belongs to an organization, so there are no workspaces outside an organization and folder for it to select. Replace `--personal` with `--organization-root` or `--folder-id` naming the locations to sweep. Do not just delete it: a `--name` or `--older-than` sweep without a location considers every workspace visible to the login, even with `--yes`.
