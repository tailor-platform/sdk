---
description: "Copy the TailorDB records, files, and IdP users of an application from one workspace to another with tailor data clone, and rehearse migrations against cloned data."
---

# Cloning Application Data

`tailor data clone` copies the data of an application from one workspace to another, for example to fill a staging workspace with production records before testing a release against them. It copies the records of every TailorDB namespace registered in the application, and optionally TailorDB file content and IdP users.

For the full option list, see [`data clone`](./cli/data.md#data-clone).

## Prerequisites

The platform rejects a clone unless all of the following hold:

- The source and target workspaces are in the same region.
- You have editor access to both workspaces.
- The application is deployed to the target under the same name, with the same namespaces and the same TailorDB schema as the source. Deploy the version that runs in the source to the target first.
- The target is empty for everything the clone copies: the TailorDB records of the application's namespaces, plus its files with `--copy-files` and its IdP users with `--copy-idp-users`.

## Cloning into another workspace

1. Deploy the source's version of the application to the target workspace:

   ```bash
   tailor deploy -w <target-workspace-id>
   ```

2. If the target already has records, empty its TailorDB tables:

   ```bash
   tailor tailordb truncate --all -w <target-workspace-id>
   ```

   `truncate` removes TailorDB records only. When you clone files or IdP users, remove those from the target separately.

3. Start the clone:

   ```bash
   tailor data clone --from <source-workspace-id> --to <target-workspace-id>
   ```

   The application is the one named by `name` in `tailor.config.ts`, so run all three steps from that application's project. The command asks for confirmation unless `--yes` is given.

## What is copied

| Data                      | Copied                    |
| ------------------------- | ------------------------- |
| TailorDB records          | Always                    |
| TailorDB file content     | With `--copy-files`       |
| IdP users, with passwords | With `--copy-idp-users`   |
| Configuration and schema  | No — deploy them yourself |

Without `--copy-files`, file fields in the target keep their references, but the content they point to is absent. Without `--copy-idp-users`, records that store IdP user IDs refer to users that do not exist in the target.

Cloning IdP users copies credentials that sign in to the source. Do not clone users from production into a workspace that people outside the production audience can reach.

## Waiting for a clone

A clone runs asynchronously on the platform. The command prints an operation ID when the clone starts, then waits until it completes or fails.

Pressing Ctrl+C, or passing `--no-wait`, stops only the waiting; the clone keeps running. Check on it later with the operation ID:

```bash
# Print the current status once
tailor data operation get --from <source-workspace-id> --to <target-workspace-id> --operation-id <operation-id>

# Wait until it completes or fails
tailor data operation get --from <source-workspace-id> --to <target-workspace-id> --operation-id <operation-id> --wait
```

With `--json`, `data clone` reports `status: "completed"` once the clone has finished, or `status: "started"` with `--no-wait`.

## Rehearsing migrations with cloned data (Beta)

To test pending TailorDB migrations against a copy of real records, use `tailor tailordb migration test --data clone` instead of cloning by hand. It creates a temporary workspace, deploys the pre-migration schema, clones the records, and runs the pending migrations. That command copies TailorDB records only; see [Clone mode](./services/tailordb/migration.md#clone-mode).
