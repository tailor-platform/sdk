---
"@tailor-platform/sdk": minor
---

Let a workspace carry its own expiry, so pruning it needs no name or age filter.

`tailor workspace create --ttl 24h` records on the workspace when it becomes prunable, and `tailor workspace prune --expired --folder-id <id>` deletes the workspaces in that location whose recorded expiry has passed. A workspace that records no expiry is never deleted this way, and neither is one whose recorded expiry cannot be read.

`tailor workspace ttl set` and `tailor workspace ttl clear` change that expiry afterwards, and `workspace get` / `workspace list` report it. `create --ttl` exits non-zero when it cannot confirm the expiry was recorded, naming the `ttl set` command that finishes the job — the workspace itself is still created and reported.

Because the expiry is recorded on the workspace rather than derived from its name, anything able to write the workspace's metadata can bring its deletion forward — and on the Platform, writing a workspace's metadata is a lesser permission than deleting it. `--expired` therefore requires at least one location, and `--name` still applies on top.

`workspace prune` now names locations instead of filtering by organization: `--organization-root <id>` selects the workspaces directly under an organization and none inside its folders, `--folder-id <id>` selects the workspaces in one folder, and `--personal` selects the workspaces belonging to no organization and no folder. Each can be repeated and they combine as a union. `--organization-id` is gone, and the location options no longer read `TAILOR_PLATFORM_ORGANIZATION_ID` or `TAILOR_PLATFORM_FOLDER_ID`, so a `--name` / `--older-than` sweep that names no location now considers every visible workspace instead of being narrowed by those variables.

Restoring a workspace does not clear its recorded expiry, so restore it and then run `workspace ttl set` or `workspace ttl clear` before the next `--expired` run — or keep it out of that run with `--exclude`.

```bash
tailor workspace create --name e2e-ws-1 --region us-west --folder-id <id> --ttl 24h
tailor workspace ttl set --workspace-id <id> --ttl 7d
tailor workspace prune --expired --folder-id <id> --dry-run
tailor workspace prune --expired --folder-id <id> --personal --yes
```
