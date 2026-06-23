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
tailor-sdk tailordb <command>
```

<!-- politty:command:tailordb:usage:end -->

<!-- politty:command:tailordb:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb:global-options-link:end -->

<!-- politty:command:tailordb:subcommands:start -->

**Commands**

| Command                                     | Description                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| [`tailordb truncate`](#tailordb-truncate)   | Truncate (delete all records from) TailorDB tables.                       |
| [`tailordb migration`](#tailordb-migration) | Manage TailorDB schema migrations.                                        |
| [`tailordb erd`](#tailordb-erd)             | Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta) |

<!-- politty:command:tailordb:subcommands:end -->

<!-- politty:command:tailordb erd:heading:start -->

### tailordb erd

<!-- politty:command:tailordb erd:heading:end -->

<!-- politty:command:tailordb erd:description:start -->

Generate TailorDB ERD viewer artifacts from local TailorDB schema. (beta)

<!-- politty:command:tailordb erd:description:end -->

<!-- politty:command:tailordb erd:usage:start -->

**Usage**

```
tailor-sdk tailordb erd <command>
```

<!-- politty:command:tailordb erd:usage:end -->

<!-- politty:command:tailordb erd:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd:global-options-link:end -->

<!-- politty:command:tailordb erd:subcommands:start -->

**Commands**

| Command                                       | Description                                                       |
| --------------------------------------------- | ----------------------------------------------------------------- |
| [`tailordb erd export`](#tailordb-erd-export) | Export TailorDB ERD static viewer from local TailorDB schema.     |
| [`tailordb erd serve`](#tailordb-erd-serve)   | Generate and serve TailorDB ERD locally with watch reload. (beta) |
| [`tailordb erd deploy`](#tailordb-erd-deploy) | Deploy ERD static website for TailorDB namespace(s).              |

<!-- politty:command:tailordb erd:subcommands:end -->

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

<!-- politty:command:tailordb erd export:heading:start -->

#### tailordb erd export

<!-- politty:command:tailordb erd export:heading:end -->

<!-- politty:command:tailordb erd export:description:start -->

Export TailorDB ERD static viewer from local TailorDB schema.

<!-- politty:command:tailordb erd export:description:end -->

<!-- politty:command:tailordb erd export:usage:start -->

**Usage**

```
tailor-sdk tailordb erd export [options]
```

<!-- politty:command:tailordb erd export:usage:end -->

<!-- politty:command:tailordb erd export:options:start -->

**Options**

| Option                    | Alias | Description                                                                                    | Required | Default              | Env                               |
| ------------------------- | ----- | ---------------------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--config <CONFIG>`       | `-c`  | Path to SDK config file                                                                        | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | TailorDB namespace name (optional if only one namespace is defined in config)                  | No       | -                    | -                                 |
| `--output <OUTPUT>`       | `-o`  | Output directory path for TailorDB ERD viewer files (writes to `<outputDir>/<namespace>/dist`) | No       | `".tailor-sdk/erd"`  | -                                 |

<!-- politty:command:tailordb erd export:options:end -->

<!-- politty:command:tailordb erd export:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd export:global-options-link:end -->

<!-- politty:command:tailordb erd serve:heading:start -->

#### tailordb erd serve

<!-- politty:command:tailordb erd serve:heading:end -->

<!-- politty:command:tailordb erd serve:description:start -->

Generate and serve TailorDB ERD locally with watch reload. (beta)

<!-- politty:command:tailordb erd serve:description:end -->

<!-- politty:command:tailordb erd serve:usage:start -->

**Usage**

```
tailor-sdk tailordb erd serve [options]
```

<!-- politty:command:tailordb erd serve:usage:end -->

<!-- politty:command:tailordb erd serve:options:start -->

**Options**

| Option                    | Alias | Description                                                               | Required | Default              | Env                               |
| ------------------------- | ----- | ------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--config <CONFIG>`       | `-c`  | Path to SDK config file                                                   | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | TailorDB namespace name (uses first namespace in config if not specified) | No       | -                    | -                                 |
| `--port <PORT>`           | -     | Local server port (0 selects a free port)                                 | No       | `0`                  | -                                 |
| `--open`                  | -     | Open the ERD viewer in the default browser                                | No       | `false`              | -                                 |

<!-- politty:command:tailordb erd serve:options:end -->

<!-- politty:command:tailordb erd serve:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb erd serve:global-options-link:end -->

<!-- politty:command:tailordb migration:heading:start -->

### tailordb migration

<!-- politty:command:tailordb migration:heading:end -->

<!-- politty:command:tailordb migration:description:start -->

Manage TailorDB schema migrations.

<!-- politty:command:tailordb migration:description:end -->

<!-- politty:command:tailordb migration:usage:start -->

**Usage**

```
tailor-sdk tailordb migration <command>
```

<!-- politty:command:tailordb migration:usage:end -->

<!-- politty:command:tailordb migration:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration:global-options-link:end -->

<!-- politty:command:tailordb migration:subcommands:start -->

**Commands**

| Command                                                       | Description                                                                                                               |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`tailordb migration generate`](#tailordb-migration-generate) | Generate migration files by detecting schema differences between current local types and the previous migration snapshot. |
| [`tailordb migration script`](#tailordb-migration-script)     | Add a migration script (migrate.ts) template to an existing migration directory.                                          |
| [`tailordb migration set`](#tailordb-migration-set)           | Set migration checkpoint to a specific number.                                                                            |
| [`tailordb migration status`](#tailordb-migration-status)     | Show the current migration status for TailorDB namespaces, including applied and pending migrations.                      |
| [`tailordb migration sync`](#tailordb-migration-sync)         | Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).                     |

<!-- politty:command:tailordb migration:subcommands:end -->

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

<!-- politty:command:tailordb migration script:heading:start -->

#### tailordb migration script

<!-- politty:command:tailordb migration script:heading:end -->

<!-- politty:command:tailordb migration script:description:start -->

Add a migration script (migrate.ts) template to an existing migration directory.

<!-- politty:command:tailordb migration script:description:end -->

<!-- politty:command:tailordb migration script:usage:start -->

**Usage**

```
tailor-sdk tailordb migration script [options] <number>
```

<!-- politty:command:tailordb migration script:usage:end -->

<!-- politty:command:tailordb migration script:arguments:start -->

**Arguments**

| Argument | Description                                           | Required |
| -------- | ----------------------------------------------------- | -------- |
| `number` | Migration number to add a script to (e.g., 0001 or 1) | Yes      |

<!-- politty:command:tailordb migration script:arguments:end -->

<!-- politty:command:tailordb migration script:options:start -->

**Options**

| Option                    | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--config <CONFIG>`       | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--namespace <NAMESPACE>` | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                                 |

<!-- politty:command:tailordb migration script:options:end -->

<!-- politty:command:tailordb migration script:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration script:global-options-link:end -->

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

<!-- politty:command:tailordb migration sync:heading:start -->

#### tailordb migration sync

<!-- politty:command:tailordb migration sync:heading:end -->

<!-- politty:command:tailordb migration sync:description:start -->

Sync remote TailorDB schema to a specific migration snapshot (recovery from --no-schema-check drift).

<!-- politty:command:tailordb migration sync:description:end -->

<!-- politty:command:tailordb migration sync:usage:start -->

**Usage**

```
tailor-sdk tailordb migration sync [options] <number>
```

<!-- politty:command:tailordb migration sync:usage:end -->

<!-- politty:command:tailordb migration sync:arguments:start -->

**Arguments**

| Argument | Description                                                                    | Required |
| -------- | ------------------------------------------------------------------------------ | -------- |
| `number` | Migration number to sync to (e.g., 0001 or 1; 0 targets the baseline snapshot) | Yes      |

<!-- politty:command:tailordb migration sync:arguments:end -->

<!-- politty:command:tailordb migration sync:options:start -->

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Target TailorDB namespace (required if multiple namespaces exist) | No       | -                    | -                                 |

<!-- politty:command:tailordb migration sync:options:end -->

<!-- politty:command:tailordb migration sync:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb migration sync:global-options-link:end -->

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

| Option                          | Alias | Description                                                                | Required | Default              | Env                               |
| ------------------------------- | ----- | -------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                               | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                          | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                    | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                                  | No       | `false`              | -                                 |
| `--all`                         | `-a`  | Truncate all tables in all owned namespaces (excludes external namespaces) | No       | `false`              | -                                 |
| `--namespace <NAMESPACE>`       | `-n`  | Truncate all tables in specified namespace                                 | No       | -                    | -                                 |

<!-- politty:command:tailordb truncate:options:end -->

<!-- politty:command:tailordb truncate:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:tailordb truncate:global-options-link:end -->
