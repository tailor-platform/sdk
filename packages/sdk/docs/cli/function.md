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

| Command                           | Aliases    | Description                                                     |
| --------------------------------- | ---------- | --------------------------------------------------------------- |
| [`function get`](#function-get)   | -          | Get a function registry by name                                 |
| [`function list`](#function-list) | -          | List function registries in a workspace                         |
| [`function logs`](#function-logs) | -          | List or get function execution logs.                            |
| [`function run`](#function-run)   | `test-run` | Run a function on the Tailor Platform server without deploying. |

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

`test-run` is a deprecated alias of this command and will be removed in v3.

> [!WARNING]
> Workflow job `.start()` calls do not work in this mode.
> Started jobs are not executed; only the target job's `body` function runs in isolation.
