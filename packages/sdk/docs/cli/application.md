# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## deploy

Deploy your application by applying the Tailor configuration.

**Aliases:** `apply`

**Usage**

```
tailor-sdk deploy [options]
```

**Options**

| Option                          | Alias | Description                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                                         | No       | `false`              | -                                 |
| `--dry-run`                     | `-d`  | Run the command without making any changes                        | No       | -                    | -                                 |
| `--no-schema-check`             | -     | Skip schema diff check against migration snapshots                | No       | -                    | -                                 |
| `--no-validate`                 | -     | Skip client-side validation against platform resource constraints | No       | -                    | -                                 |
| `--no-cache`                    | -     | Disable bundle caching for this run                               | No       | -                    | -                                 |
| `--clean-cache`                 | -     | Clean the bundle cache before building                            | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
**Config File Modification:**

On first run, `deploy` automatically injects a stable `id: "<uuid>"` field into your `defineConfig({...})` call in `tailor.config.ts`. This UUID is used to track your application across renames so the SDK can recognize ownership across renames. Commit the generated id to version control. See [Configuration](../configuration.md#application-settings) for details.

**Migration Handling:**

When migrations are configured (`db.tailordb.migration` in config), the `deploy` command automatically:

1. Detects pending migration scripts that haven't been executed
2. Applies schema changes in a safe order (pre-migration → script execution → post-migration)
3. Runs the pending migration scripts
4. Updates the migration checkpoint so the same migrations are not re-run

See [Automatic Migration Execution](../services/tailordb-migration.md#automatic-migration-execution) for details on automatic migration execution.

**Schema Check:**

By default, `deploy` performs two verification steps:

1. **Local schema check**: Verifies that local schema changes match the migration files. This ensures migrations are properly generated before deployment.
2. **Remote schema check**: Verifies that the remote schema matches the expected state based on migration history. This detects schema drift caused by manual changes or other developers.

If remote schema drift is detected, the deploy will fail with an error showing the differences. This helps prevent applying migrations to an inconsistent state.

Use `--no-schema-check` to skip both verifications (not recommended for production).

**Plan Output:**

Before applying changes, `deploy` shows a preview of the planned resource changes.

- `+` means the resource will be created
- `~` means the resource will be updated
- `-` means the resource will be deleted
- `±` means the resource will be replaced

After the detailed list, a summary line is printed:

```text
Plan: 5 to create, 3 to update, 1 to delete, 25 unchanged
```

Use `--dry-run` to preview the plan without applying anything.

## remove

Remove all resources managed by the application from the workspace.

**Usage**

```
tailor-sdk remove [options]
```

**Options**

| Option                          | Alias | Description               | Required | Default              | Env                               |
| ------------------------------- | ----- | ------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file   | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false`              | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## show

Show information about the deployed application.

**Usage**

```
tailor-sdk show [options]
```

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## open

Open Tailor Platform Console.

**Usage**

```
tailor-sdk open [options]
```

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

## api

Call Tailor Platform API endpoints directly.

**Usage**

```
tailor-sdk api [options] [command] <endpoint>
```

**Arguments**

| Argument   | Description                                                                                  | Required |
| ---------- | -------------------------------------------------------------------------------------------- | -------- |
| `endpoint` | API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication'). | Yes      |

**Options**

| Option                          | Alias | Description                                                                       | Required | Default              | Env                               |
| ------------------------------- | ----- | --------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                      | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                 | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                           | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--body <BODY>`                 | `-b`  | Request body as JSON.                                                             | No       | `"{}"`               | -                                 |
| `--field <FIELD>`               | `-f`  | Set a body field as `key=value` (repeatable; dotted keys nest). Overrides --body. | No       | -                    | -                                 |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                       | Description                                                  |
| ----------------------------- | ------------------------------------------------------------ |
| [`api list`](#api-list)       | List all invocable OperatorService methods.                  |
| [`api inspect`](#api-inspect) | Print the input message tree of an OperatorService endpoint. |

**Examples**

**Call an endpoint; workspaceId is auto-injected.**

```bash
$ tailor-sdk api GetApplication -b '{"applicationName":"app-1"}'
```

**Same as above, using --field instead of --body.**

```bash
$ tailor-sdk api GetApplication -f applicationName=app-1
```

**List all invocable OperatorService methods.**

```bash
$ tailor-sdk api list
```

**Show the input message tree for an endpoint.**

```bash
$ tailor-sdk api inspect GetApplication
```

**Notes**

Use `tailor-sdk api list` to enumerate invocable methods and `tailor-sdk api inspect <endpoint>` to print an endpoint's input message tree (combine with `--json` for machine-readable output).

The request body is inferred from the target endpoint's request schema, and commonly required fields are auto-injected so they can be omitted from `--body`:

- `workspaceId` — resolved from `-w` / `TAILOR_PLATFORM_WORKSPACE_ID` / the selected profile.
- `namespaceName` — resolved from `tailor.config.ts` based on the endpoint's service:
  - Auth / Tenant / UserProfile endpoints use `auth.name`.
  - IdP / TailorDB / Pipeline endpoints use the sole configured namespace when exactly one is defined.

Values already present in `--body` are never overridden. If a value cannot be resolved (e.g. no config found), injection is silently skipped and the server-side validation error takes precedence.

Use `--field key=value` (repeatable) to set request body fields without writing JSON. Dotted keys (e.g. `application.name=foo`) build nested objects. `--field` overrides matching fields in `--body` and tab-completes from the endpoint's request schema.

### api inspect

Print the input message tree of an OperatorService endpoint.

**Usage**

```
tailor-sdk api inspect <endpoint>
```

**Arguments**

| Argument   | Description                                                                                     | Required |
| ---------- | ----------------------------------------------------------------------------------------------- | -------- |
| `endpoint` | API endpoint to inspect (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication'). | Yes      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Show fields of GetApplicationRequest.**

```bash
$ tailor-sdk api inspect GetApplication
```

**Inspect a deeply nested input with `(oneof config)` annotations.**

```bash
$ tailor-sdk api inspect CreateExecutorExecutor
```

**Notes**

Combine with the global `--json` flag for a machine-readable descriptor. Recursive type references and `oneof` membership are annotated. Use `tailor-sdk api list` to discover endpoint names.

### api list

List all invocable OperatorService methods.

**Usage**

```
tailor-sdk api list
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Notes**

Only single-request (non-streaming) methods are listed, because the CLI issues a single JSON request and reads one JSON response.
