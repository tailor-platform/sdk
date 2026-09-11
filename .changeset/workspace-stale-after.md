---
"@tailor-platform/sdk": minor
---

Let a workspace carry its own expiry, so pruning it needs no name or age filter.

`tailor workspace create --ttl 24h` records on the workspace when it becomes prunable, and `tailor workspace prune --expired --organization-id <id>` deletes the workspaces in that scope whose recorded expiry has passed. A workspace that records no expiry is never deleted this way, and neither is one whose recorded expiry cannot be read.

`tailor workspace ttl set` and `tailor workspace ttl clear` change that expiry afterwards, and `workspace get` / `workspace list` report it. `create --ttl` exits non-zero when it cannot confirm the expiry was recorded, naming the `ttl set` command that finishes the job — the workspace itself is still created and reported.

Because the expiry is recorded on the workspace rather than derived from its name, anything able to write the workspace's metadata can bring its deletion forward — and on the Platform, writing a workspace's metadata is a lesser permission than deleting it. `--expired` therefore requires `--organization-id`, `--folder-id`, or `--personal`; `--name` still applies on top. `--personal` selects workspaces belonging to neither an organization nor a folder and cannot be combined with the other scope options, including their environment variables.

Restoring a workspace does not clear its recorded expiry, so restore it and then run `workspace ttl set` or `workspace ttl clear` before the next `--expired` run — or keep it out of that run with `--exclude`.

```bash
tailor workspace create --name e2e-ws-1 --region us-west --ttl 24h
tailor workspace ttl set --workspace-id <id> --ttl 7d
tailor workspace prune --expired --personal --dry-run
tailor workspace prune --expired --personal --yes
```
