# TailorDB Commands

Commands for managing TailorDB tables, data, and schema migrations.

## tailordb

Manage TailorDB tables and data.

**Usage**

```
tailor-sdk tailordb <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                     | Description                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| [`tailordb truncate`](#tailordb-truncate)   | Truncate (delete all records from) TailorDB tables.                       |
| [`tailordb migration`](#tailordb-migration) | Manage TailorDB schema migrations.                                        |
| [`tailordb erd`](#tailordb-erd)             | Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta) |

### tailordb truncate

Truncate (delete all records from) TailorDB tables.

**Usage**

```
tailor-sdk tailordb truncate [options] [types]
```

**Arguments**

| Argument | Description            | Required |
| -------- | ---------------------- | -------- |
| `types`  | Type names to truncate | No       |

**Options**

| Option                          | Alias | Description                                                                | Required | Default              | Env                               |
| ------------------------------- | ----- | -------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                               | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                          | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                    | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                                  | No       | `false`              | -                                 |
| `--all`                         | `-a`  | Truncate all tables in all owned namespaces (excludes external namespaces) | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Truncate all tables in specified namespace                                 | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Usage Examples:**

```bash
# Truncate all tables in all namespaces (requires confirmation)
tailor-sdk tailordb truncate --all

# Truncate all tables in all namespaces (skip confirmation)
tailor-sdk tailordb truncate --all --yes

# Truncate all tables in a specific namespace
tailor-sdk tailordb truncate --namespace myNamespace

# Truncate specific types (namespace is auto-detected)
tailor-sdk tailordb truncate User Post Comment

# Truncate specific types with confirmation skipped
tailor-sdk tailordb truncate User Post --yes
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

Note: Migration scripts are automatically executed during `tailor-sdk deploy`. See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details.

**Usage**

```
tailor-sdk tailordb migration <command>
```

**Commands**

| Command                                                       | Description                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`tailordb migration generate`](#tailordb-migration-generate) | Generate migration files by detecting schema differences between current local types and the previous migration snapshot. |
| [`tailordb migration script`](#tailordb-migration-script)     | Add a migration script (migrate.ts) template to an existing migration directory.                                          |
| [`tailordb migration set`](#tailordb-migration-set)           | Set migration checkpoint to a specific number.                                                                            |
| [`tailordb migration status`](#tailordb-migration-status)     | Show the current migration status for TailorDB namespaces, including applied and pending migrations.                      |
| [`tailordb migration sync`](#tailordb-migration-sync)         | Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).                     |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration generate

Generate migration files by detecting schema differences between current local types and the previous migration snapshot.

**Usage**

```
tailor-sdk tailordb migration generate [options]
```

**Options**

| Option              | Alias | Description                                | Required | Default              | Env                               |
| ------------------- | ----- | ------------------------------------------ | -------- | -------------------- | --------------------------------- |
| `--yes`             | `-y`  | Skip confirmation prompts                  | No       | `false`              | -                                 |
| `--config <CONFIG>` | `-c`  | Path to SDK config file                    | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--name <NAME>`     | `-n`  | Optional description for the migration     | No       | -                    | -                                 |
| `--init`            | -     | Delete existing migrations and start fresh | No       | `false`              | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration script

Add a migration script (migrate.ts) template to an existing migration directory.

**Usage**

```
tailor-sdk tailordb migration script [options] <number>
```

**Arguments**

| Argument | Description                                           | Required |
| -------- | ----------------------------------------------------- | -------- |
| `number` | Migration number to add a script to (e.g., 0001 or 1) | Yes      |

**Options**

| Option                    | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--config <CONFIG>`       | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration set

Set migration checkpoint to a specific number.

**Usage**

```
tailor-sdk tailordb migration set [options] <number>
```

**Arguments**

| Argument | Description                               | Required |
| -------- | ----------------------------------------- | -------- |
| `number` | Migration number to set (e.g., 0001 or 1) | Yes      |

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration status

Show the current migration status for TailorDB namespaces, including applied and pending migrations.

**Usage**

```
tailor-sdk tailordb migration status [options]
```

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (shows all namespaces if not specified) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb migration sync

Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).

**Usage**

```
tailor-sdk tailordb migration sync [options] <number>
```

**Arguments**

| Argument | Description                                                                    | Required |
| -------- | ------------------------------------------------------------------------------ | -------- |
| `number` | Migration number to sync to (e.g., 0001 or 1; 0 targets the baseline snapshot) | Yes      |

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**See also:** For migration concepts, configuration, workflow, and troubleshooting, see the [TailorDB Migrations guide](../services/tailordb-migration.md).

### tailordb erd

Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta)

**Usage**

```
tailor-sdk tailordb erd <command>
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                       | Description                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| [`tailordb erd export`](#tailordb-erd-export) | Export TailorDB ERD static viewer from local TailorDB schema.     |
| [`tailordb erd serve`](#tailordb-erd-serve)   | Generate and serve TailorDB ERD locally with watch reload. (beta) |
| [`tailordb erd deploy`](#tailordb-erd-deploy) | Deploy ERD static website for TailorDB namespace(s).              |

#### tailordb erd export

Export TailorDB ERD static viewer from local TailorDB schema.

**Usage**

```
tailor-sdk tailordb erd export [options]
```

**Options**

| Option                    | Alias | Description                                                                                    | Required | Default              | Env                               |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--config <CONFIG>`       | `-c`  | Path to SDK config file                                                                        | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | TailorDB namespace name (optional if only one namespace is defined in config)                  | No       | -                    | -                                 |
| `--output <OUTPUT>`       | `-o`  | Output directory path for TailorDB ERD viewer files (writes to `<outputDir>/<namespace>/dist`) | No       | `".tailor-sdk/erd"`  | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb erd serve

Generate and serve TailorDB ERD locally with watch reload. (beta)

**Usage**

```
tailor-sdk tailordb erd serve [options]
```

**Options**

| Option                    | Alias | Description                                                               | Required | Default              | Env                               |
| ------------------------- | ----- | ------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--config <CONFIG>`       | `-c`  | Path to SDK config file                                                   | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | TailorDB namespace name (uses first namespace in config if not specified) | No       | -                    | -                                 |
| `--port <PORT>`           | -     | Local server port (0 selects a free port)                                 | No       | `0`                  | -                                 |
| `--open`                  | -     | Open the ERD viewer in the default browser                                | No       | `false`              | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

#### tailordb erd deploy

Deploy ERD static website for TailorDB namespace(s).

**Usage**

```
tailor-sdk tailordb erd deploy [options]
```

**Options**

| Option                          | Alias | Description                                                                         | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                        | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                   | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                             | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>`       | `-n`  | TailorDB namespace name (optional - deploys all namespaces with erdSite if omitted) | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes:**

- ERD commands build from the local TailorDB schema, including plugin-generated TailorDB types.
- `tailordb erd export` writes a self-contained `index.html` viewer to `<output>/<namespace>/dist`.
- `tailordb erd serve` watches the config file and TailorDB type files, then reloads the browser viewer when the rebuilt `index.html` reports a new embedded schema revision.
- `tailordb erd deploy` still requires `erdSite` in `tailor.config.ts` because it uploads the generated viewer to a configured Static Website.

**Usage Examples:**

```bash
# Deploy ERD for all namespaces with erdSite configured
tailor-sdk tailordb erd deploy

# Deploy ERD for a specific namespace
tailor-sdk tailordb erd deploy --namespace myNamespace

# Deploy ERD with JSON output
tailor-sdk tailordb erd deploy --json
```

**Notes:**

- This command is a beta feature and may introduce breaking changes in future releases
- Requires `erdSite` to be configured in `tailor.config.ts` for each namespace you want to deploy
- Example config:
  ```typescript
  export default defineConfig({
    db: {
      myNamespace: {
        // ... table definitions
        erdSite: "my-erd-site-name",
      },
    },
  });
  ```
