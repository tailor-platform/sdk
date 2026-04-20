# Function Commands

Commands for viewing function execution logs.

<!-- politty:command:function:heading:start -->

## function

<!-- politty:command:function:heading:end -->

<!-- politty:command:function:description:start -->

Manage functions

<!-- politty:command:function:description:end -->

<!-- politty:command:function:usage:start -->

**Usage**

```
tailor-sdk function [command]
```

<!-- politty:command:function:usage:end -->

<!-- politty:command:function:subcommands:start -->

**Commands**

| Command                                   | Description                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| [`function logs`](#function-logs)         | List or get function execution logs.                            |
| [`function test-run`](#function-test-run) | Run a function on the Tailor Platform server without deploying. |

<!-- politty:command:function:subcommands:end -->

<!-- politty:command:function:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:function:global-options-link:end -->
<!-- politty:command:function logs:heading:start -->

### function logs

<!-- politty:command:function logs:heading:end -->

<!-- politty:command:function logs:description:start -->

List or get function execution logs.

<!-- politty:command:function logs:description:end -->

<!-- politty:command:function logs:usage:start -->

**Usage**

```
tailor-sdk function logs [options] [executionId]
```

<!-- politty:command:function logs:usage:end -->

<!-- politty:command:function logs:arguments:start -->

**Arguments**

| Argument      | Description                                         | Required |
| ------------- | --------------------------------------------------- | -------- |
| `executionId` | Execution ID (if provided, shows details with logs) | No       |

<!-- politty:command:function logs:arguments:end -->

<!-- politty:command:function logs:options:start -->

**Options**

| Option                          | Alias | Description                                      | Required | Default  | Env                            |
| ------------------------------- | ----- | ------------------------------------------------ | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                     | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                         | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0: unlimited) | No       | `50`     | -                              |

<!-- politty:command:function logs:options:end -->

<!-- politty:command:function logs:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:function logs:global-options-link:end -->

<!-- politty:command:function logs:examples:start -->

**Examples**

**List all function execution logs**

```bash
$ tailor-sdk function logs
```

**Get execution details with logs**

```bash
$ tailor-sdk function logs <execution-id>
```

**Output as JSON**

```bash
$ tailor-sdk function logs --json
```

**Get execution details as JSON**

```bash
$ tailor-sdk function logs <execution-id> --json
```

<!-- politty:command:function logs:examples:end -->

<!-- politty:command:function logs:notes:start -->

**Notes**

When viewing a specific execution that failed, the command displays error details with the stack trace mapped back to original source files via the inline sourcemap (clickable file links and code snippets, matching `function test-run` output).

When the deployed script cannot be downloaded or the function has been redeployed since the execution, the command falls back to a plain-text error display to avoid showing misleading source locations.

<!-- politty:command:function logs:notes:end -->

<!-- politty:command:function test-run:heading:start -->

### function test-run

<!-- politty:command:function test-run:heading:end -->
<!-- politty:command:function test-run:description:start -->

Run a function on the Tailor Platform server without deploying.

<!-- politty:command:function test-run:description:end -->
<!-- politty:command:function test-run:usage:start -->

**Usage**

```
tailor-sdk function test-run [options] <file>
```

<!-- politty:command:function test-run:usage:end -->
<!-- politty:command:function test-run:arguments:start -->

**Arguments**

| Argument | Description               | Required |
| -------- | ------------------------- | -------- |
| `file`   | Path to the function file | Yes      |

<!-- politty:command:function test-run:arguments:end -->
<!-- politty:command:function test-run:options:start -->

**Options**

| Option                          | Alias | Description                                                              | Required | Default              | Env                                 |
| ------------------------------- | ----- | ------------------------------------------------------------------------ | -------- | -------------------- | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                             | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                        | No       | -                    | `TAILOR_PLATFORM_PROFILE`           |
| `--name <NAME>`                 | `-n`  | Workflow job name to run (matches the `name` field of createWorkflowJob) | No       | -                    | -                                   |
| `--arg <ARG>`                   | `-a`  | JSON argument to pass to the function                                    | No       | -                    | -                                   |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name for authentication                                     | No       | -                    | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                  | No       | `"tailor.config.ts"` | -                                   |

<!-- politty:command:function test-run:options:end -->
<!-- politty:command:function test-run:examples:start -->

**Examples**

**Run a resolver with input arguments**

```bash
$ tailor-sdk function test-run resolvers/add.ts --arg '{"a":1,"b":2}'
```

**Run a specific workflow job by name**

```bash
$ tailor-sdk function test-run workflows/sample.ts --name validate-order
```

**Run a pre-bundled .js file directly**

```bash
$ tailor-sdk function test-run build/resolvers/add.js --arg '{"a":1,"b":2}'
```

<!-- politty:command:function test-run:examples:end -->
<!-- politty:command:function test-run:notes:start -->

**Notes**

You can pass either a source file (`.ts`) or a pre-bundled file (`.js`).
When a `.js` file is provided, detection and bundling are skipped and the file is executed as-is.

> [!WARNING]
> Workflow job `.trigger()` calls do not work in test-run mode.
> Triggered jobs are not executed; only the target job's `body` function runs in isolation.

<!-- politty:command:function test-run:notes:end -->

<!-- politty:command:function test-run:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:function test-run:global-options-link:end -->
