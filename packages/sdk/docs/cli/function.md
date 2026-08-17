# Function Commands

Commands for managing function registries and viewing function execution logs.

## function

Manage functions

**Usage**

```
tailor function [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                               | Aliases    | Description                                                     |
| ------------------------------------- | ---------- | --------------------------------------------------------------- |
| [`function get`](#function-get)       | -          | Get a function registry by name                                 |
| [`function list`](#function-list)     | -          | List function registries in a workspace                         |
| [`function logs`](#function-logs)     | -          | List or get function execution logs.                            |
| [`function run`](#function-run)       | `test-run` | Run a function on the Tailor Platform server without deploying. |
| [`function script`](#function-script) | -          | Scaffold a one-off script to run with `function run`.           |

### function get

Get a function registry by name

**Usage**

```
tailor function get [options]
```

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--name <NAME>`                 | `-n`  | Function name     | Yes      | -       | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### function list

List function registries in a workspace

**Usage**

```
tailor function list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### function logs

List or get function execution logs.

**Usage**

```
tailor function logs [options] [execution-id]
```

**Arguments**

| Argument       | Description                                         | Required |
| -------------- | --------------------------------------------------- | -------- |
| `execution-id` | Execution ID (if provided, shows details with logs) | No       |

**Options**

| Option                          | Alias | Description                                      | Required | Default  | Env                            |
| ------------------------------- | ----- | ------------------------------------------------ | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                     | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                         | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0: unlimited) | No       | `50`     | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**List all function execution logs**

```bash
$ tailor function logs
```

**Get execution details with logs**

```bash
$ tailor function logs <execution-id>
```

**Output as JSON**

```bash
$ tailor function logs --json
```

**Get execution details as JSON**

```bash
$ tailor function logs <execution-id> --json
```

**Notes**

When viewing a specific execution that failed, the command displays error details with the stack trace mapped back to your original source files (clickable file links and code snippets, matching `function run` output).

Stack traces are mapped only when the execution includes a content hash for the exact build that ran. If the content hash is missing or the build is no longer available, the command falls back to a plain-text error display.

### function run

Run a function on the Tailor Platform server without deploying.

**Aliases:** `test-run`

**Usage**

```
tailor function run [options] <file>
```

**Arguments**

| Argument | Description               | Required |
| -------- | ------------------------- | -------- |
| `file`   | Path to the function file | Yes      |

**Options**

| Option                          | Alias | Description                                                                                    | Required | Default              | Env                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------- | -------- | -------------------- | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                   | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                              | No       | -                    | `TAILOR_PLATFORM_PROFILE`           |
| `--name <NAME>`                 | `-n`  | Workflow job name to run (matches the `name` field of createWorkflowJob)                       | No       | -                    | -                                   |
| `--arg <ARG>`                   | `-a`  | JSON argument to pass to the function                                                          | No       | -                    | -                                   |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name for authentication. Falls back to the active profile's default machine user. | No       | -                    | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                                        | No       | `"tailor.config.ts"` | -                                   |
| `--allow-schema-drift`          | -     | Run a scaffolded script even when its schema snapshot no longer matches                        | No       | `false`              | -                                   |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Run a resolver with input arguments**

```bash
$ tailor function run resolvers/add.ts --arg '{"a":1,"b":2}'
```

**Run a specific workflow job by name**

```bash
$ tailor function run workflows/sample.ts --name validate-order
```

**Run a pre-bundled .js file directly**

```bash
$ tailor function run build/resolvers/add.js --arg '{"a":1,"b":2}'
```

**Notes**

You can pass either a source file (`.ts`) or a pre-bundled file (`.js`).
When a `.js` file is provided, detection and bundling are skipped and the file is executed as-is.

A script scaffolded by `function script` with a generated `db.ts` is checked against its `db.snapshot.json` before execution and refused on schema drift; pass `--allow-schema-drift` to run it anyway. The check compares table and field structure; hook and validator code changes are not detected.

`test-run` is a deprecated alias of this command and will be removed in v3.

> [!WARNING]
> Workflow job `.start()` calls do not work in this mode.
> Started jobs are not executed; only the target job's `body` function runs in isolation.

### function script

Scaffold a one-off script to run with `function run`.

**Usage**

```
tailor function script [options] <file>
```

**Arguments**

| Argument | Description                                      | Required |
| -------- | ------------------------------------------------ | -------- |
| `file`   | Path to create the script at (must end with .ts) | Yes      |

**Options**

| Option                          | Alias | Description                                                           | Required | Default              | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------------------- | -------- | -------------------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                          | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                     | No       | -                    | `TAILOR_PLATFORM_PROFILE`      |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                            | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`           |
| `--namespace <NAMESPACE>`       | -     | Target TailorDB namespace (required when the config does not pin one) | No       | -                    | -                              |
| `--remote`                      | -     | Generate script-scoped DB types from the deployed schema              | No       | `false`              | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Scaffold a one-off script (single-namespace project)**

```bash
$ tailor function script scripts/fix-prices.ts
```

**Scaffold a script targeting a specific namespace**

```bash
$ tailor function script scripts/fix-prices.ts --namespace tailordb
```

**Scaffold from a deployed or external namespace**

```bash
$ tailor function script scripts/fix-prices.ts --namespace shared --remote
```

**Notes**

The scaffolded script is a plain default-exported function; execute it with `tailor function run <file>`.

By default, when the project configures `kyselyTypePlugin`, the skeleton imports `getDB()` from the plugin's generated types. Without the plugin, the command uses the namespace's local table definitions to write a script-scoped `db.ts` plus a `db.snapshot.json` next to the script; `function run` refuses to run the script when that snapshot no longer matches the deployed or locally defined table and field structure.

Pass `--remote` to generate the script-scoped files from the deployed schema instead, even when `kyselyTypePlugin` is configured. This is required for an external namespace. Re-running the command refreshes `db.ts` and `db.snapshot.json` from the selected source and leaves the script itself untouched.
