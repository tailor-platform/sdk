---
description: "Truncate TailorDB table data and generate, test, validate, and apply TailorDB schema migrations with the tailor CLI."
---

# TailorDB Commands

Commands for managing TailorDB tables, data, and schema migrations.

## tailordb

Manage TailorDB tables and data.

**Usage**

```
tailor tailordb <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                     | Description                                         |
| ------------------------------------------- | --------------------------------------------------- |
| [`tailordb truncate`](#tailordb-truncate)   | Truncate (delete all records from) TailorDB tables. |
| [`tailordb migration`](#tailordb-migration) | Manage TailorDB schema migrations (beta).           |

### tailordb truncate

Truncate (delete all records from) TailorDB tables.

**Usage**

```
tailor tailordb truncate [options] [tables]
```

**Arguments**

| Argument                      | Description             | Required |
| ----------------------------- | ----------------------- | -------- |
| `tables`, `--tables <TABLES>` | Table names to truncate | No       |

**Options**

| Option                          | Alias | Description                                                                | Required | Default              | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                               | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                          | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                                 | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                                  | No       | `false`              | -                              |
| `--all`                         | `-a`  | Truncate all tables in all owned namespaces (excludes external namespaces) | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Truncate all tables in specified namespace                                 | No       | -                    | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Usage Examples:**

```bash
# Truncate all tables in all namespaces (requires confirmation)
tailor tailordb truncate --all

# Truncate all tables in all namespaces (skip confirmation)
tailor tailordb truncate --all --yes

# Truncate all tables in a specific namespace
tailor tailordb truncate --namespace myNamespace

# Truncate specific tables (namespace is auto-detected)
tailor tailordb truncate User Post Comment

# Truncate specific tables with confirmation skipped
tailor tailordb truncate User Post --yes
```

**Notes:**

- You must specify exactly one of: `--all`, `--namespace`, or table names
- When truncating specific tables, the namespace is automatically detected from your config
- Confirmation prompts vary based on the operation:
  - `--all`: requires typing `truncate all`
  - `--namespace`: requires typing `truncate <namespace-name>`
  - Specific tables: requires typing `yes`
- Use `--yes` flag to skip confirmation prompts (useful for scripts and CI/CD)
- Namespaces declared with `{ external: true }` are skipped by `--all` and rejected with a dedicated error when targeted by `--namespace`. Run truncate from the app that owns the namespace.

### tailordb migration

Manage TailorDB schema migrations (beta).

Note: Migration scripts are automatically executed during `tailor deploy`. See [Automatic Migration Execution](../services/tailordb/migration.md#automatic-migration-execution) for details.

**Usage**

```
tailor tailordb migration <command>
```

**Commands**

| Command                                                           | Description                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tailordb migration generate`](#tailordb-migration-generate)     | Generate migration files by detecting schema differences between current local tables and the previous migration snapshot.                                                                                                                                                                                                |
| [`tailordb migration rebaseline`](#tailordb-migration-rebaseline) | Collapse the full migration history into a new 0000 baseline.                                                                                                                                                                                                                                                             |
| [`tailordb migration resolve`](#tailordb-migration-resolve)       | Settle a migration that a failed deploy left partially applied, or whose run a deploy could not confirm.                                                                                                                                                                                                                  |
| [`tailordb migration script`](#tailordb-migration-script)         | Add a migration script (migrate.ts) template to an existing migration directory, or record with --no-script that a migration intentionally has none.                                                                                                                                                                      |
| [`tailordb migration set`](#tailordb-migration-set)               | Set migration checkpoint to a specific number.                                                                                                                                                                                                                                                                            |
| [`tailordb migration status`](#tailordb-migration-status)         | Show the current migration status for TailorDB namespaces, including applied and pending migrations.                                                                                                                                                                                                                      |
| [`tailordb migration sync`](#tailordb-migration-sync)             | Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).                                                                                                                                                                                                                     |
| [`tailordb migration test`](#tailordb-migration-test)             | Test pending migrations with seed fixtures or cloned data in a temporary workspace.                                                                                                                                                                                                                                       |
| [`tailordb migration validate`](#tailordb-migration-validate)     | Validate the full migration history, unreviewed generated migration scripts, and schema drift (local tables vs. migration snapshot, remote schema vs. migration checkpoint) without deploying. This includes the migration and schema-drift checks used by 'deploy' and exits with a non-zero code when issues are found. |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration generate

Generate migration files by detecting schema differences between current local tables and the previous migration snapshot.

**Usage**

```
tailor tailordb migration generate [options]
```

**Options**

| Option                                | Alias | Description                                                                                                                                                                                                                                 | Required | Default              | Env                  |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | -------------------- |
| `--yes`                               | `-y`  | Skip confirmation prompts                                                                                                                                                                                                                   | No       | `false`              | -                    |
| `--config <CONFIG>`                   | `-c`  | Path to Tailor config file                                                                                                                                                                                                                  | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH` |
| `--name <NAME>`                       | `-n`  | Optional description for the migration                                                                                                                                                                                                      | No       | -                    | -                    |
| `--init`                              | -     | Delete existing migrations and start fresh (all namespaces with migrations configured, or only the one given by --namespace)                                                                                                                | No       | `false`              | -                    |
| `--data-only`                         | -     | Create a migration with no schema changes whose migration script runs a standalone data transformation                                                                                                                                      | No       | `false`              | -                    |
| `--namespace <NAMESPACE>`             | -     | Target TailorDB namespace for --data-only (required if multiple namespaces exist), or the only namespace --init resets                                                                                                                      | No       | -                    | -                    |
| `--rename <RENAME>`                   | -     | Record a field, table, or nested member rename instead of remove + add (format: "Table.oldField:newField", "OldTable:NewTable", or "Table.field.oldMember:newMember"; repeatable). Renames require a migration script that copies the data. | No       | -                    | -                    |
| `--drop <DROP>`                       | -     | Confirm that a removed field, table, or nested member is a genuine removal, not a rename (format: "Table.field", "Table", or "Table.field.member"; repeatable). Required in non-interactive runs for a removal with rename candidates.      | No       | -                    | -                    |
| `--expand-contract <EXPAND_CONTRACT>` | -     | Convert a field type, or a single value into an array, through a temporary field (format: "Table.field"; repeatable). Generates two migrations.                                                                                             | No       | -                    | -                    |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration rebaseline

Collapse the full migration history into a new 0000 baseline.

**Usage**

```
tailor tailordb migration rebaseline [options]
```

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                            |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                        | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Re-baselining removes migrations after 0000 from the working tree, records a new migration history ID, and resets the connected workspace checkpoint without changing its schema or data. Every environment must already have applied the latest migration before you run this command.

#### tailordb migration resolve

Settle a migration that a failed deploy left partially applied, or whose run a deploy could not confirm.

**Usage**

```
tailor tailordb migration resolve [options]
```

**Options**

| Option                          | Alias | Description                                                            | Required | Default              | Env                            |
| ------------------------------- | ----- | ---------------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                           | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                      | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                             | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                              | No       | `false`              | -                              |
| `--rollback`                    | -     | Return the namespace to the schema before the in-progress migration    | No       | `false`              | -                              |
| `--complete`                    | -     | Apply the schema of the in-progress migration and mark it as completed | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist)      | No       | -                    | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Use this after a deploy failed partway through a migration whose `migrate.ts` exports `steps`, or after a deploy could not confirm whether the script of a migration ran (`MIGRATION_OUTCOME_UNKNOWN`). The migration stays in progress: when `maintenanceMode` is on in your config, the tables of its namespace stay in maintenance mode, and `sync` and `rebaseline` are refused, while `set` accepts only the number of the in-progress migration. A deploy stops before changing anything while a run it could not confirm is not settled.

- `--rollback` sends the schema of the migration before the failed one. The next deploy runs the failed migration again, from its first step for a script that exports `steps`. Data changes the script already made are not undone.
- `--complete` sends the schema of the failed migration itself and records it as completed, without running its `migrate.ts` again. Fix the data first (for example with `tailor query`), and make sure no record lacks a value for a field that becomes required.

For a run that a deploy could not confirm, the command reads how the run ended and shows it before asking for confirmation: use `--complete` when it succeeded, and `--rollback` when it failed, was canceled, or did not start. It refuses while the run is still running, and warns when the option you chose does not fit how the run ended.

Both options remove the in-progress record, take the tables out of maintenance mode, and remove the temporary resources of the failed run, so `deploy` and the other migration commands work again. As with `tailordb migration sync`, the local migration history must reproduce the current table definitions. If sending the schema stops partway, run the command again.

#### tailordb migration script

Add a migration script (migrate.ts) template to an existing migration directory, or record with --no-script that a migration intentionally has none.

**Usage**

```
tailor tailordb migration script [options] <number>
```

**Arguments**

| Argument | Description                                           | Required |
| -------- | ----------------------------------------------------- | -------- |
| `number` | Migration number to add a script to (e.g., 0001 or 1) | Yes      |

**Options**

| Option                    | Alias | Description                                                                                  | Required | Default              | Env                  |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------- | -------- | -------------------- | -------------------- |
| `--config <CONFIG>`       | `-c`  | Path to Tailor config file                                                                   | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | Target TailorDB namespace (required if multiple namespaces exist)                            | No       | -                    | -                    |
| `--no-script`             | -     | Record that this migration intentionally runs without a migration script (requires --reason) | No       | -                    | -                    |
| `--reason <REASON>`       | -     | Reason why no migration script is needed (used with --no-script)                             | No       | -                    | -                    |
| `--with-test`             | -     | Also add the migrate.test.ts and migrate.pglite.test.ts scaffolds                            | No       | -                    | -                    |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

When `migrate.ts` already exists, running the command clears a previously recorded `--no-script` acknowledgment, and `--with-test` adds only the tests that do not exist yet (writing `db.pglite.ts` if it is missing). `migrate.pglite.test.ts` is scaffolded only when `@electric-sql/pglite` is installed in the project.

#### tailordb migration set

Set migration checkpoint to a specific number.

**Usage**

```
tailor tailordb migration set [options] <number>
```

**Arguments**

| Argument | Description                               | Required |
| -------- | ----------------------------------------- | -------- |
| `number` | Migration number to set (e.g., 0001 or 1) | Yes      |

**Options**

| Option                          | Alias | Description                                                                             | Required | Default              | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                       | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                                              | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                                               | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist)                       | No       | -                    | -                              |
| `--force`                       | -     | Proceed even when the namespace records a migration history ID other than the local one | No       | `false`              | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

The migration number must be a 4-digit value (e.g. `0001`) or a bare integer (e.g. `1`) within 0–9999, and must exist in the local migration history; `0` is always accepted as the baseline, provided the local history passes validation. A gapped history is rejected.

The command refuses to run when the namespace records a migration history ID other than the local one, or one that cannot be read, unless the namespace has neither a checkpoint nor a history ID yet. `--force` replaces that history ID with the local one, or removes it when the local history has none, and still asks for confirmation unless `--yes` is given.

Metadata lookup failures (authentication, permission, or network errors) are reported as errors; only a not-yet-deployed namespace is treated as having no checkpoint.

#### tailordb migration status

Show the current migration status for TailorDB namespaces, including applied and pending migrations.

**Usage**

```
tailor tailordb migration status [options]
```

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                            |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                        | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (shows all namespaces if not specified) | No       | -                    | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Local migration files are checked for a valid layout (numbering and required files in each migration directory) and a compatible format version, and deployed migration history IDs must match the local baseline. Invalid or incompatible files, history mismatches, a remote checkpoint ahead of the latest local migration, and metadata lookup failures are reported per namespace and make the command exit non-zero; only a not-yet-deployed namespace is treated as having no applied migrations.

#### tailordb migration sync

Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).

**Usage**

```
tailor tailordb migration sync [options] <number>
```

**Arguments**

| Argument | Description                                                                    | Required |
| -------- | ------------------------------------------------------------------------------ | -------- |
| `number` | Migration number to sync to (e.g., 0001 or 1; 0 targets the baseline snapshot) | Yes      |

**Options**

| Option                          | Alias | Description                                                                             | Required | Default              | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                       | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                                              | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                                               | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist)                       | No       | -                    | -                              |
| `--force`                       | -     | Proceed even when the namespace records a migration history ID other than the local one | No       | `false`              | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

The command refuses to run when the namespace records a migration history ID other than the local one, or one that cannot be read, unless the namespace has neither a checkpoint nor a history ID yet. `--force` overwrites the tables and that history ID with those of the local history, and still asks for confirmation unless `--yes` is given.

#### tailordb migration test

Test pending migrations with seed fixtures or cloned data in a temporary workspace.

**Usage**

```
tailor tailordb migration test [options]
```

**Options**

| Option                                        | Alias | Description                                                                                                                                                                                                                      | Required | Default              | Env                               |
| --------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>`               | `-w`  | Workspace ID                                                                                                                                                                                                                     | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`                         | `-p`  | Workspace profile                                                                                                                                                                                                                | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`                           | `-c`  | Path to Tailor config file                                                                                                                                                                                                       | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`              |
| `--yes`                                       | `-y`  | Acknowledge that a designated target workspace may be overwritten                                                                                                                                                                | No       | `false`              | -                                 |
| `--data <DATA>`                               | -     | Data source for the migration test (seed or clone)                                                                                                                                                                               | No       | `"seed"`             | -                                 |
| `--target-workspace-id <TARGET_WORKSPACE_ID>` | -     | Existing throwaway workspace to retain after the test (requires --yes)                                                                                                                                                           | No       | -                    | -                                 |
| `--keep`                                      | -     | Keep the automatically created workspace after the test                                                                                                                                                                          | No       | `false`              | -                                 |
| `--organization-id <ORGANIZATION_ID>`         | -     | Organization to create the temporary workspace in, at its root unless --folder-id is given (default: the source workspace's organization and folder). With --target-workspace-id, must match the target's organization           | No       | -                    | `TAILOR_PLATFORM_ORGANIZATION_ID` |
| `--folder-id <FOLDER_ID>`                     | -     | Folder to create the temporary workspace in (default: the source workspace's folder). Requires --organization-id when the source workspace is not in an organization. With --target-workspace-id, must match the target's folder | No       | -                    | `TAILOR_PLATFORM_FOLDER_ID`       |
| `--assert <ASSERT>`                           | -     | Path to a TypeScript assertion script to run after migrations                                                                                                                                                                    | No       | -                    | -                                 |
| `--assert-namespace <ASSERT_NAMESPACE>`       | -     | TailorDB namespace exposed to the assertion script                                                                                                                                                                               | No       | -                    | -                                 |
| `--keep-ttl <KEEP_TTL>`                       | -     | Record an expiry on the kept workspace, e.g. 24h or 7d, so workspace prune --expired can delete it (requires --keep)                                                                                                             | No       | -                    | -                                 |
| `--clone-timeout <CLONE_TIMEOUT>`             | -     | How long to wait for the clone to finish with --data clone, e.g. 30s or 10m (default: 30m)                                                                                                                                       | No       | -                    | -                                 |
| `--machine-user <MACHINE_USER>`               | -     | Machine user for seed, migration, and assertion script execution                                                                                                                                                                 | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

The source workspace is read-only. Without --target-workspace-id, the command creates a workspace in the source workspace's region and deletes it after success or failure; pass --keep to retain it for inspection. Right after creating the workspace it records a 24h expiry (unless --keep is given without --keep-ttl), so if the run is interrupted before the command can delete the workspace, workspace prune --expired removes it later. A designated target is retained and requires --yes. Clone mode copies TailorDB records only; it does not copy IdP users or file blobs. With --keep-ttl, the kept workspace records an expiry; it is not deleted automatically, but workspace prune --expired removes it once the expiry has passed. Organization and folder IDs loaded by --env-file are used the same way as the options; command-line options take precedence, and empty env-file values are ignored.

#### tailordb migration validate

Validate the full migration history, unreviewed generated migration scripts, and schema drift (local tables vs. migration snapshot, remote schema vs. migration checkpoint) without deploying. This includes the migration and schema-drift checks used by 'deploy' and exits with a non-zero code when issues are found.

**Usage**

```
tailor tailordb migration validate [options]
```

**Options**

| Option                          | Alias | Description                                                                | Required | Default              | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                               | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                          | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                                 | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (validates all namespaces if not specified)      | No       | -                    | -                              |
| `--strict`                      | -     | Also fail when a pending migration can drop data without an acknowledgment | No       | `false`              | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**See also:** For migration concepts, configuration, workflow, and troubleshooting, see the [TailorDB Migrations guide](../services/tailordb/migration.md).

### tailordb erd (Beta)

The `tailordb erd` commands (export, diff, serve, deploy) are provided by the `@tailor-platform/sdk-plugin-tailordb-erd` CLI plugin. Install it next to the SDK and keep running `tailor tailordb erd <command>` as before:

```bash
npm install -D @tailor-platform/sdk-plugin-tailordb-erd
tailor tailordb erd export --namespace myNamespace
```

See the plugin's README for the full command reference.
