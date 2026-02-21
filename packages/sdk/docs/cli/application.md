# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

<!-- politty:command:init:start -->

## init

Initialize a new project using create-sdk.

**Usage**

```
tailor-sdk init [options] [name]
```

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Project name | No       |

**Options**

| Option                  | Alias | Description   | Required | Default |
| ----------------------- | ----- | ------------- | -------- | ------- |
| `--template <TEMPLATE>` | `-t`  | Template name | No       | -       |

<!-- politty:command:init:end -->

<!-- politty:command:generate:start -->

## generate

Generate files using Tailor configuration.

**Usage**

```
tailor-sdk generate [options]
```

**Options**

| Option              | Alias | Description                                    | Required | Default              |
| ------------------- | ----- | ---------------------------------------------- | -------- | -------------------- |
| `--config <CONFIG>` | `-c`  | Path to SDK config file                        | No       | `"tailor.config.ts"` |
| `--watch`           | `-W`  | Watch for type/resolver changes and regenerate | No       | `false`              |

<!-- politty:command:generate:end -->

<!-- politty:command:apply:start -->

## apply

Apply Tailor configuration to deploy your application.

**Usage**

```
tailor-sdk apply [options]
```

**Options**

| Option                          | Alias | Description                                        | Required | Default              |
| ------------------------------- | ----- | -------------------------------------------------- | -------- | -------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                       | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                  | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                            | No       | `"tailor.config.ts"` |
| `--yes`                         | `-y`  | Skip confirmation prompts                          | No       | `false`              |
| `--dry-run`                     | `-d`  | Run the command without making any changes         | No       | -                    |
| `--no-schema-check`             | -     | Skip schema diff check against migration snapshots | No       | -                    |

<!-- politty:command:apply:end -->

**Migration Handling:**

When migrations are configured (`db.tailordb.migration` in config), the `apply` command automatically:

1. Detects pending migration scripts that haven't been executed
2. Applies schema changes in a safe order (pre-migration → script execution → post-migration)
3. Executes migration scripts via TestExecScript API
4. Updates migration state labels in TailorDB metadata

See [TailorDB Commands](./tailordb.md#automatic-migration-execution) for details on automatic migration execution.

**Schema Check:**

By default, `apply` performs two verification steps:

1. **Local schema check**: Verifies that local schema changes match the migration files. This ensures migrations are properly generated before deployment.
2. **Remote schema check**: Verifies that the remote schema matches the expected state based on migration history. This detects schema drift caused by manual changes or other developers.

If remote schema drift is detected, the apply will fail with an error showing the differences. This helps prevent applying migrations to an inconsistent state.

Use `--no-schema-check` to skip both verifications (not recommended for production).

<!-- politty:command:remove:start -->

## remove

Remove all resources managed by the application from the workspace.

**Usage**

```
tailor-sdk remove [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default              |
| ------------------------------- | ----- | ------------------------- | -------- | -------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file   | No       | `"tailor.config.ts"` |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false`              |

<!-- politty:command:remove:end -->

<!-- politty:command:show:start -->

## show

Show information about the deployed application.

**Usage**

```
tailor-sdk show [options]
```

**Options**

| Option                          | Alias | Description             | Required | Default              |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON          | No       | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` |

<!-- politty:command:show:end -->

<!-- politty:command:open:start -->

## open

Open Tailor Platform Console.

**Usage**

```
tailor-sdk open [options]
```

**Options**

| Option                          | Alias | Description             | Required | Default              |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` |

<!-- politty:command:open:end -->

<!-- politty:command:api:start -->

## api

Call Tailor Platform API endpoints directly.

**Usage**

```
tailor-sdk api [options] <endpoint>
```

**Arguments**

| Argument   | Description                                                                                 | Required |
| ---------- | ------------------------------------------------------------------------------------------- | -------- |
| `endpoint` | API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication') | Yes      |

**Options**

| Option                          | Alias | Description          | Required | Default |
| ------------------------------- | ----- | -------------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON       | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID         | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile    | No       | -       |
| `--body <BODY>`                 | `-b`  | Request body as JSON | No       | `"{}"`  |

<!-- politty:command:api:end -->
