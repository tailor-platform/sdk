# Application Commands

Commands for managing Tailor Platform applications. These commands work with `tailor.config.ts`.

<!-- politty:command:init:heading:start -->

## init

<!-- politty:command:init:heading:end -->

<!-- politty:command:init:description:start -->

Initialize a new project using create-sdk.

<!-- politty:command:init:description:end -->

<!-- politty:command:init:usage:start -->

**Usage**

```
tailor-sdk init [options] [name]
```

<!-- politty:command:init:usage:end -->

<!-- politty:command:init:arguments:start -->

**Arguments**

| Argument | Description  | Required |
| -------- | ------------ | -------- |
| `name`   | Project name | No       |

<!-- politty:command:init:arguments:end -->

<!-- politty:command:init:options:start -->

**Options**

| Option                  | Alias | Description   | Required | Default |
| ----------------------- | ----- | ------------- | -------- | ------- |
| `--template <TEMPLATE>` | `-t`  | Template name | No       | -       |

<!-- politty:command:init:options:end -->

<!-- politty:command:init:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:init:global-options-link:end -->

<!-- politty:command:generate:heading:start -->

## generate

<!-- politty:command:generate:heading:end -->

<!-- politty:command:generate:description:start -->

Generate files using Tailor configuration.

<!-- politty:command:generate:description:end -->

<!-- politty:command:generate:usage:start -->

**Usage**

```
tailor-sdk generate [options]
```

<!-- politty:command:generate:usage:end -->

<!-- politty:command:generate:options:start -->

**Options**

| Option              | Alias | Description                                    | Required | Default              |
| ------------------- | ----- | ---------------------------------------------- | -------- | -------------------- |
| `--config <CONFIG>` | `-c`  | Path to SDK config file                        | No       | `"tailor.config.ts"` |
| `--watch`           | `-W`  | Watch for type/resolver changes and regenerate | No       | `false`              |

<!-- politty:command:generate:options:end -->

<!-- politty:command:generate:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:generate:global-options-link:end -->

<!-- politty:command:apply:heading:start -->

## apply

<!-- politty:command:apply:heading:end -->

<!-- politty:command:apply:description:start -->

Apply Tailor configuration to deploy your application.

<!-- politty:command:apply:description:end -->

<!-- politty:command:apply:usage:start -->

**Usage**

```
tailor-sdk apply [options]
```

<!-- politty:command:apply:usage:end -->

<!-- politty:command:apply:options:start -->

**Options**

| Option                          | Alias | Description                                        | Required | Default              | Env                               |
| ------------------------------- | ----- | -------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                       | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                  | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                            | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts                          | No       | `false`              | -                                 |
| `--dry-run`                     | `-d`  | Run the command without making any changes         | No       | -                    | -                                 |
| `--no-schema-check`             | -     | Skip schema diff check against migration snapshots | No       | -                    | -                                 |
| `--no-cache`                    | -     | Disable bundle caching for this run                | No       | -                    | -                                 |
| `--clean-cache`                 | -     | Clean the bundle cache before building             | No       | -                    | -                                 |

<!-- politty:command:apply:options:end -->

<!-- politty:command:apply:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:apply:global-options-link:end -->

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

**Plan Output:**

Before applying changes, `apply` shows a preview of the planned resource changes.

- `+` means the resource will be created
- `~` means the resource will be updated
- `-` means the resource will be deleted
- `±` means the resource will be replaced

After the detailed list, a summary line is printed:

```text
Plan: 5 to create, 3 to update, 1 to delete, 25 unchanged
```

Use `--dry-run` to preview the plan without applying anything.

<!-- politty:command:remove:heading:start -->

## remove

<!-- politty:command:remove:heading:end -->

<!-- politty:command:remove:description:start -->

Remove all resources managed by the application from the workspace.

<!-- politty:command:remove:description:end -->

<!-- politty:command:remove:usage:start -->

**Usage**

```
tailor-sdk remove [options]
```

<!-- politty:command:remove:usage:end -->

<!-- politty:command:remove:options:start -->

**Options**

| Option                          | Alias | Description               | Required | Default              | Env                               |
| ------------------------------- | ----- | ------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID              | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile         | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file   | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--yes`                         | `-y`  | Skip confirmation prompts | No       | `false`              | -                                 |

<!-- politty:command:remove:options:end -->

<!-- politty:command:remove:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:remove:global-options-link:end -->

<!-- politty:command:show:heading:start -->

## show

<!-- politty:command:show:heading:end -->

<!-- politty:command:show:description:start -->

Show information about the deployed application.

<!-- politty:command:show:description:end -->

<!-- politty:command:show:usage:start -->

**Usage**

```
tailor-sdk show [options]
```

<!-- politty:command:show:usage:end -->

<!-- politty:command:show:options:start -->

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

<!-- politty:command:show:options:end -->

<!-- politty:command:show:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:show:global-options-link:end -->

<!-- politty:command:open:heading:start -->

## open

<!-- politty:command:open:heading:end -->

<!-- politty:command:open:description:start -->

Open Tailor Platform Console.

<!-- politty:command:open:description:end -->

<!-- politty:command:open:usage:start -->

**Usage**

```
tailor-sdk open [options]
```

<!-- politty:command:open:usage:end -->

<!-- politty:command:open:options:start -->

**Options**

| Option                          | Alias | Description             | Required | Default              | Env                               |
| ------------------------------- | ----- | ----------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID            | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile       | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |

<!-- politty:command:open:options:end -->

<!-- politty:command:open:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:open:global-options-link:end -->

<!-- politty:command:api:heading:start -->

## api

<!-- politty:command:api:heading:end -->

<!-- politty:command:api:description:start -->

Call Tailor Platform API endpoints directly.

<!-- politty:command:api:description:end -->

<!-- politty:command:api:usage:start -->

**Usage**

```
tailor-sdk api [options] [endpoint]
```

<!-- politty:command:api:usage:end -->

<!-- politty:command:api:arguments:start -->

**Arguments**

| Argument   | Description                                                                                  | Required |
| ---------- | -------------------------------------------------------------------------------------------- | -------- |
| `endpoint` | API endpoint to call (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication'). | No       |

<!-- politty:command:api:arguments:end -->

<!-- politty:command:api:options:start -->

**Options**

| Option                          | Alias | Description                                                                                        | Required | Default              | Env                               |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------- | -------- | -------------------- | --------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                       | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                  | No       | -                    | `TAILOR_PLATFORM_PROFILE`         |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                                            | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH` |
| `--body <BODY>`                 | `-b`  | Request body as JSON.                                                                              | No       | `"{}"`               | -                                 |
| `--field <FIELD>`               | `-f`  | Set a request field as key=value. Repeatable. Supports dot-notation (e.g. tailordbType.name=User). | No       | `[]`                 | -                                 |
| `--inspect`                     | -     | Print the input message tree of the endpoint and exit without making a request.                    | No       | `false`              | -                                 |
| `--list`                        | -     | List all available OperatorService methods and exit.                                               | No       | `false`              | -                                 |

<!-- politty:command:api:options:end -->

<!-- politty:command:api:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:api:global-options-link:end -->

<!-- politty:command:api:examples:start -->

**Examples**

**List all available OperatorService methods.**

```bash
$ tailor-sdk api --list
```

**Show the input message tree for an endpoint.**

```bash
$ tailor-sdk api GetApplication --inspect
```

**Call with a single field; workspaceId is auto-injected.**

```bash
$ tailor-sdk api GetApplication --field applicationName=app-1
```

**Use repeated --field for proto repeated fields.**

```bash
$ tailor-sdk api CreateApplication -f applicationName=app -f cors=https://a -f cors=https://b
```

**Use raw JSON body for advanced shapes.**

```bash
$ tailor-sdk api ListWorkspaces -b '{"pageSize":10}'
```

<!-- politty:command:api:examples:end -->

<!-- politty:command:api:notes:start -->

**Notes**

Use `--list` to enumerate available methods and `--inspect` to print an endpoint's input message tree (combine with `--json` for machine-readable output).

Build the request body in one of two ways:

- `--body` accepts a JSON object string (escape hatch for arbitrary shapes including `map` and `bytes`).
- `--field <key>=<value>` (repeatable, alias `-f`) sets fields one at a time. Supports dot-notation for nested messages (`tailordbType.name=User`) and repeats the same key to populate `repeated` scalar/enum fields. Values are coerced according to the proto field type. `map` fields, `repeated` of messages, and `google.protobuf.*` well-known types (Duration, Timestamp, FieldMask, …) have JSON encodings that cannot be assembled from `--field` entries; use `--body` for those.

When both are supplied, `--body` is the base and `--field` entries override on top.

Commonly required fields are auto-injected when not already set:

- `workspaceId` — resolved from `-w` / `TAILOR_PLATFORM_WORKSPACE_ID` / the selected profile.
- `namespaceName` — resolved from `tailor.config.ts` based on the endpoint's service:
  - Auth / Tenant / UserProfile endpoints use `auth.name`.
  - IdP / TailorDB / Pipeline endpoints use the sole configured namespace when exactly one is defined.

If a value cannot be resolved (e.g. no config found), injection is silently skipped and the server-side validation error takes precedence.

<!-- politty:command:api:notes:end -->
