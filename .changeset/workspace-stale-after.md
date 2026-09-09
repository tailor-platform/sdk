---
"@tailor-platform/sdk": minor
---

Let a workspace carry its own expiry, so pruning it needs no name or age filter.

`tailor workspace create --ttl 24h` records on the workspace when it becomes prunable, and `tailor workspace prune --expired` deletes the workspaces whose recorded expiry has passed. A workspace that records no expiry is never deleted this way, and neither is one whose recorded expiry cannot be read.

`tailor workspace ttl set` and `tailor workspace ttl clear` change that expiry afterwards, and `workspace get` / `workspace list` report it. `create --ttl` exits non-zero when it cannot confirm the expiry was recorded, naming the `ttl set` command that finishes the job — the workspace itself is still created and reported.

Because the expiry travels with the workspace rather than being derived from its name, anything able to write the workspace's metadata can bring its deletion forward; `--name-prefix`, `--name-regex`, `--organization-id`, and `--folder-id` still apply to `--expired` and are worth keeping in a shared organization. Restoring a workspace does not clear its recorded expiry, so restore it and then run `workspace ttl set` or `workspace ttl clear` before the next `--expired` run — or keep it out of that run with `--exclude`.

```bash
tailor workspace create --name e2e-ws-1 --region us-west --ttl 24h
tailor workspace ttl set --workspace-id <id> --ttl 7d
tailor workspace prune --expired --dry-run
tailor workspace prune --expired --yes
```
