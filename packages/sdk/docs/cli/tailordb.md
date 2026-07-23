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
| [`tailordb migration`](#tailordb-migration) | Manage TailorDB schema migrations.                  |

### tailordb truncate

Truncate (delete all records from) TailorDB tables.

**Usage**

```
tailor tailordb truncate [options] [types]
```

**Arguments**

| Argument | Description            | Required |
| -------- | ---------------------- | -------- |
| `types`  | Type names to truncate | No       |

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

# Truncate specific types (namespace is auto-detected)
tailor tailordb truncate User Post Comment

# Truncate specific types with confirmation skipped
tailor tailordb truncate User Post --yes
```

**Notes:**

- You must specify exactly one of: `--all`, `--namespace`, or type names
- When truncating specific types, the namespace is automatically detected from your config
- Confirmation prompts vary based on the operation:
  - `--all`: requires typing `truncate all`
  - `--namespace`: requires typing `truncate <namespace-name>`
  - Specific types: requires typing `yes`
- Use `--yes` flag to skip confirmation prompts (useful for scripts and CI/CD)
- Namespaces declared with `{ external: true }` are skipped by `--all` and rejected with a dedicated error when targeted by `--namespace`. Run truncate from the app that owns the namespace.

### tailordb migration

Manage TailorDB schema migrations.

Note: Migration scripts are automatically executed during `tailor deploy`. See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details.

**Usage**

```
tailor tailordb migration <command>
```

**Commands**

| Command                                                       | Description                                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tailordb migration generate`](#tailordb-migration-generate) | Generate migration files by detecting schema differences between current local types and the previous migration snapshot.                            |
| [`tailordb migration script`](#tailordb-migration-script)     | Add a migration script (migrate.ts) template to an existing migration directory, or record with --no-script that a migration intentionally has none. |
| [`tailordb migration set`](#tailordb-migration-set)           | Set migration checkpoint to a specific number.                                                                                                       |
| [`tailordb migration status`](#tailordb-migration-status)     | Show the current migration status for TailorDB namespaces, including applied and pending migrations.                                                 |
| [`tailordb migration sync`](#tailordb-migration-sync)         | Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).                                                |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration generate

Generate migration files by detecting schema differences between current local types and the previous migration snapshot.

**Usage**

```
tailor tailordb migration generate [options]
```

**Options**

| Option              | Alias | Description                                | Required | Default              | Env                  |
| ------------------- | ----- | ------------------------------------------ | -------- | -------------------- | -------------------- |
| `--yes`             | `-y`  | Skip confirmation prompts                  | No       | `false`              | -                    |
| `--config <CONFIG>` | `-c`  | Path to Tailor config file                 | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH` |
| `--name <NAME>`     | `-n`  | Optional description for the migration     | No       | -                    | -                    |
| `--init`            | -     | Delete existing migrations and start fresh | No       | `false`              | -                    |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

| Option                          | Alias | Description                                                       | Required | Default              | Env                            |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                        | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

| Option                          | Alias | Description                                                       | Required | Default              | Env                            |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                        | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                              |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**See also:** For migration concepts, configuration, workflow, and troubleshooting, see the [TailorDB Migrations guide](../services/tailordb-migration.md).

### tailordb erd

The `tailordb erd` commands (export, diff, serve, deploy) are provided by the `@tailor-platform/sdk-plugin-tailordb-erd` CLI plugin. Install it next to the SDK and keep running `tailor tailordb erd <command>` as before:

```bash
npm install -D @tailor-platform/sdk-plugin-tailordb-erd@next
tailor tailordb erd export --namespace myNamespace
```

See the plugin's README for the full command reference.
