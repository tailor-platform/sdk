# TailorDB Commands

Commands for managing TailorDB tables, data, and schema migrations.

<!-- politty:command:tailordb:heading:start -->

## tailordb

<!-- politty:command:tailordb:heading:end -->

<!-- politty:command:tailordb:description:start -->

Manage TailorDB tables and data.

<!-- politty:command:tailordb:description:end -->

<!-- politty:command:tailordb:usage:start -->

**Usage**

```
tailor-sdk tailordb [command]
```

<!-- politty:command:tailordb:usage:end -->

<!-- politty:command:tailordb:subcommands:start -->

**Commands**

| Command                                     | Description                                                           |
| ------------------------------------------- | --------------------------------------------------------------------- |
| [`tailordb truncate`](#tailordb-truncate)   | Truncate (delete all records from) TailorDB tables.                   |
| [`tailordb migration`](#tailordb-migration) | Manage TailorDB schema migrations.                                    |
| [`tailordb erd`](#tailordb-erd)             | Generate ERD artifacts for TailorDB namespaces using Liam ERD. (beta) |

<!-- politty:command:tailordb:subcommands:end -->

<!-- politty:command:tailordb:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb:global-options-link:end -->
<!-- politty:command:tailordb truncate:heading:start -->

### tailordb truncate

<!-- politty:command:tailordb truncate:heading:end -->

<!-- politty:command:tailordb truncate:description:start -->

Truncate (delete all records from) TailorDB tables.

<!-- politty:command:tailordb truncate:description:end -->

<!-- politty:command:tailordb truncate:usage:start -->

**Usage**

```
tailor-sdk tailordb truncate [options] [types]
```

<!-- politty:command:tailordb truncate:usage:end -->

<!-- politty:command:tailordb truncate:arguments:start -->

**Arguments**

| Argument | Description            | Required |
| -------- | ---------------------- | -------- |
| `types`  | Type names to truncate | No       |

<!-- politty:command:tailordb truncate:arguments:end -->

<!-- politty:command:tailordb truncate:options:start -->

**Options**

| Option                          | Alias | Description                                | Required | Default              | Env                               |
| ------------------------------- | ----- | ------------------------------------------ | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                               | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                          | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                    | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                  | No       | `false`              | -                                 |
| `--all`                         | `-a`  | Truncate all tables in all namespaces      | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Truncate all tables in specified namespace | No       | -                    | -                                 |

<!-- politty:command:tailordb truncate:options:end -->

<!-- politty:command:tailordb truncate:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb truncate:global-options-link:end -->

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

<!-- politty:command:tailordb migration:heading:start -->

### tailordb migration

<!-- politty:command:tailordb migration:heading:end -->

<!-- politty:command:tailordb migration:description:start -->

Manage TailorDB schema migrations.

<!-- politty:command:tailordb migration:description:end -->

Note: Migration scripts are automatically executed during `tailor-sdk apply`. See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details.

<!-- politty:command:tailordb migration:usage:start -->

**Usage**

```
tailor-sdk tailordb migration [command]
```

<!-- politty:command:tailordb migration:usage:end -->

<!-- politty:command:tailordb migration:subcommands:start -->

**Commands**

| Command                                                       | Description                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`tailordb migration generate`](#tailordb-migration-generate) | Generate migration files by detecting schema differences between current local types and the previous migration snapshot. |
| [`tailordb migration set`](#tailordb-migration-set)           | Set migration checkpoint to a specific number.                                                                            |
| [`tailordb migration status`](#tailordb-migration-status)     | Show the current migration status for TailorDB namespaces, including applied and pending migrations.                      |

<!-- politty:command:tailordb migration:subcommands:end -->

<!-- politty:command:tailordb migration:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration:global-options-link:end -->
<!-- politty:command:tailordb migration generate:heading:start -->

#### tailordb migration generate

<!-- politty:command:tailordb migration generate:heading:end -->

<!-- politty:command:tailordb migration generate:description:start -->

Generate migration files by detecting schema differences between current local types and the previous migration snapshot.

<!-- politty:command:tailordb migration generate:description:end -->

<!-- politty:command:tailordb migration generate:usage:start -->

**Usage**

```
tailor-sdk tailordb migration generate [options]
```

<!-- politty:command:tailordb migration generate:usage:end -->

<!-- politty:command:tailordb migration generate:options:start -->

**Options**

| Option              | Alias | Description                                | Required | Default              | Env                               |
| ------------------- | ----- | ------------------------------------------ | -------- | -------------------- | --------------------------------- |
| `--yes`             | `-y`  | Skip confirmation prompts                  | No       | `false`              | -                                 |
| `--config <CONFIG>` | `-c`  | Path to SDK config file                    | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--name <NAME>`     | `-n`  | Optional description for the migration     | No       | -                    | -                                 |
| `--init`            | -     | Delete existing migrations and start fresh | No       | `false`              | -                                 |

<!-- politty:command:tailordb migration generate:options:end -->

<!-- politty:command:tailordb migration generate:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration generate:global-options-link:end -->
<!-- politty:command:tailordb migration set:heading:start -->

#### tailordb migration set

<!-- politty:command:tailordb migration set:heading:end -->

<!-- politty:command:tailordb migration set:description:start -->

Set migration checkpoint to a specific number.

<!-- politty:command:tailordb migration set:description:end -->

<!-- politty:command:tailordb migration set:usage:start -->

**Usage**

```
tailor-sdk tailordb migration set [options] <number>
```

<!-- politty:command:tailordb migration set:usage:end -->

<!-- politty:command:tailordb migration set:arguments:start -->

**Arguments**

| Argument | Description                               | Required |
| -------- | ----------------------------------------- | -------- |
| `number` | Migration number to set (e.g., 0001 or 1) | Yes      |

<!-- politty:command:tailordb migration set:arguments:end -->

<!-- politty:command:tailordb migration set:options:start -->

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                                 |

<!-- politty:command:tailordb migration set:options:end -->

<!-- politty:command:tailordb migration set:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration set:global-options-link:end -->
<!-- politty:command:tailordb migration status:heading:start -->

#### tailordb migration status

<!-- politty:command:tailordb migration status:heading:end -->

<!-- politty:command:tailordb migration status:description:start -->

Show the current migration status for TailorDB namespaces, including applied and pending migrations.

<!-- politty:command:tailordb migration status:description:end -->

<!-- politty:command:tailordb migration status:usage:start -->

**Usage**

```
tailor-sdk tailordb migration status [options]
```

<!-- politty:command:tailordb migration status:usage:end -->

<!-- politty:command:tailordb migration status:options:start -->

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (shows all namespaces if not specified) | No       | -                    | -                                 |

<!-- politty:command:tailordb migration status:options:end -->

<!-- politty:command:tailordb migration status:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration status:global-options-link:end -->

**See also:** For migration concepts, configuration, workflow, and troubleshooting, see the [TailorDB Migrations guide](../services/tailordb-migration.md).

<!-- politty:command:tailordb erd:heading:start -->

### tailordb erd

<!-- politty:command:tailordb erd:heading:end -->

<!-- politty:command:tailordb erd:description:start -->

Generate ERD artifacts for TailorDB namespaces using Liam ERD. (beta)

<!-- politty:command:tailordb erd:description:end -->

<!-- politty:command:tailordb erd:usage:start -->

**Usage**

```
tailor-sdk tailordb erd [command]
```

<!-- politty:command:tailordb erd:usage:end -->

<!-- politty:command:tailordb erd:subcommands:start -->

**Commands**

| Command                                       | Description                                                      |
| --------------------------------------------- | ---------------------------------------------------------------- |
| [`tailordb erd export`](#tailordb-erd-export) | Export Liam ERD dist from applied TailorDB schema.               |
| [`tailordb erd serve`](#tailordb-erd-serve)   | Generate and serve ERD locally (liam build + serve dist). (beta) |
| [`tailordb erd deploy`](#tailordb-erd-deploy) | Deploy ERD static website for TailorDB namespace(s).             |

<!-- politty:command:tailordb erd:subcommands:end -->

<!-- politty:command:tailordb erd:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd:global-options-link:end -->
<!-- politty:command:tailordb erd export:heading:start -->

#### tailordb erd export

<!-- politty:command:tailordb erd export:heading:end -->

<!-- politty:command:tailordb erd export:description:start -->

Export Liam ERD dist from applied TailorDB schema.

<!-- politty:command:tailordb erd export:description:end -->

<!-- politty:command:tailordb erd export:usage:start -->

**Usage**

```
tailor-sdk tailordb erd export [options]
```

<!-- politty:command:tailordb erd export:usage:end -->

<!-- politty:command:tailordb erd export:options:start -->

**Options**

| Option                          | Alias | Description                                                                                          | Required | Default              | Env                               |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                         | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                    | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                                              | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>`       | `-n`  | TailorDB namespace name (optional if only one namespace is defined in config)                        | No       | -                    | -                                 |
| `--output <OUTPUT>`             | `-o`  | Output directory path for tbls-compatible ERD JSON (writes to `<outputDir>/<namespace>/schema.json`) | No       | `".tailor-sdk/erd"`  | -                                 |

<!-- politty:command:tailordb erd export:options:end -->

<!-- politty:command:tailordb erd export:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd export:global-options-link:end -->
<!-- politty:command:tailordb erd serve:heading:start -->

#### tailordb erd serve

<!-- politty:command:tailordb erd serve:heading:end -->

<!-- politty:command:tailordb erd serve:description:start -->

Generate and serve ERD locally (liam build + serve dist). (beta)

<!-- politty:command:tailordb erd serve:description:end -->

<!-- politty:command:tailordb erd serve:usage:start -->

**Usage**

```
tailor-sdk tailordb erd serve [options]
```

<!-- politty:command:tailordb erd serve:usage:end -->

<!-- politty:command:tailordb erd serve:options:start -->

**Options**

| Option                          | Alias | Description                                                               | Required | Default              | Env                               |
| ------------------------------- | ----- | ------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                              | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                         | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                   | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>`       | `-n`  | TailorDB namespace name (uses first namespace in config if not specified) | No       | -                    | -                                 |

<!-- politty:command:tailordb erd serve:options:end -->

<!-- politty:command:tailordb erd serve:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd serve:global-options-link:end -->
<!-- politty:command:tailordb erd deploy:heading:start -->

#### tailordb erd deploy

<!-- politty:command:tailordb erd deploy:heading:end -->

<!-- politty:command:tailordb erd deploy:description:start -->

Deploy ERD static website for TailorDB namespace(s).

<!-- politty:command:tailordb erd deploy:description:end -->

<!-- politty:command:tailordb erd deploy:usage:start -->

**Usage**

```
tailor-sdk tailordb erd deploy [options]
```

<!-- politty:command:tailordb erd deploy:usage:end -->

<!-- politty:command:tailordb erd deploy:options:start -->

**Options**

| Option                          | Alias | Description                                                                         | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                        | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                   | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                             | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>`       | `-n`  | TailorDB namespace name (optional - deploys all namespaces with erdSite if omitted) | No       | -                    | -                                 |

<!-- politty:command:tailordb erd deploy:options:end -->

<!-- politty:command:tailordb erd deploy:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd deploy:global-options-link:end -->

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
