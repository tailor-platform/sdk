---
"@tailor-platform/sdk": minor
---

Let a workspace carry its own expiry, so pruning it needs no name or age filter.

`tailor workspace create --stale-after 24h` records on the workspace when it becomes prunable, and `tailor workspace prune --expired` deletes the workspaces whose recorded expiry has passed. A workspace that records no expiry is never deleted this way, and neither is one whose recorded expiry cannot be read.

Because the expiry travels with the workspace rather than being derived from its name, anything able to write the workspace's metadata can bring its deletion forward; `--name-prefix`, `--name-regex`, `--organization-id`, and `--folder-id` still apply to `--expired` and are worth keeping in a shared organization. Restoring a workspace does not clear its recorded expiry, so give a restored workspace a new expiry — or exclude it — before the next `--expired` run.

```bash
tailor workspace create --name e2e-ws-1 --region us-west --stale-after 24h
tailor workspace prune --expired --dry-run
tailor workspace prune --expired --yes
```
