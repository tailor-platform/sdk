# Workflow Commands

Commands for managing workflows and workflow executions.

<!-- politty:command:workflow:heading:start -->

## workflow

<!-- politty:command:workflow:heading:end -->

<!-- politty:command:workflow:description:start -->

Manage workflows and workflow executions.

<!-- politty:command:workflow:description:end -->

<!-- politty:command:workflow:usage:start -->

**Usage**

```
tailor-sdk workflow [command]
```

<!-- politty:command:workflow:usage:end -->

<!-- politty:command:workflow:subcommands:start -->

**Commands**

| Command                                       | Description                                    |
| --------------------------------------------- | ---------------------------------------------- |
| [`workflow list`](#workflow-list)             | List all workflows in the workspace.           |
| [`workflow get`](#workflow-get)               | Get workflow details.                          |
| [`workflow start`](#workflow-start)           | Start a workflow execution.                    |
| [`workflow wait`](#workflow-wait)             | Wait for a workflow execution.                 |
| [`workflow executions`](#workflow-executions) | List or get workflow executions.               |
| [`workflow resume`](#workflow-resume)         | Resume a failed or pending workflow execution. |

<!-- politty:command:workflow:subcommands:end -->

<!-- politty:command:workflow:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow:global-options-link:end -->
<!-- politty:command:workflow list:heading:start -->

### workflow list

<!-- politty:command:workflow list:heading:end -->

<!-- politty:command:workflow list:description:start -->

List all workflows in the workspace.

<!-- politty:command:workflow list:description:end -->

<!-- politty:command:workflow list:usage:start -->

**Usage**

```
tailor-sdk workflow list [options]
```

<!-- politty:command:workflow list:usage:end -->

<!-- politty:command:workflow list:options:start -->

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

<!-- politty:command:workflow list:options:end -->

<!-- politty:command:workflow list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow list:global-options-link:end -->
<!-- politty:command:workflow get:heading:start -->

### workflow get

<!-- politty:command:workflow get:heading:end -->

<!-- politty:command:workflow get:description:start -->

Get workflow details.

<!-- politty:command:workflow get:description:end -->

<!-- politty:command:workflow get:usage:start -->

**Usage**

```
tailor-sdk workflow get [options] <name>
```

<!-- politty:command:workflow get:usage:end -->

<!-- politty:command:workflow get:arguments:start -->

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

<!-- politty:command:workflow get:arguments:end -->

<!-- politty:command:workflow get:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:workflow get:options:end -->

<!-- politty:command:workflow get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow get:global-options-link:end -->
<!-- politty:command:workflow start:heading:start -->

### workflow start

<!-- politty:command:workflow start:heading:end -->

<!-- politty:command:workflow start:description:start -->

Start a workflow execution.

<!-- politty:command:workflow start:description:end -->

<!-- politty:command:workflow start:usage:start -->

**Usage**

```
tailor-sdk workflow start [options] <name>
```

<!-- politty:command:workflow start:usage:end -->

<!-- politty:command:workflow start:arguments:start -->

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

<!-- politty:command:workflow start:arguments:end -->

<!-- politty:command:workflow start:options:start -->

**Options**

| Option                          | Alias | Description                                                                 | Required | Default              | Env                                 |
| ------------------------------- | ----- | --------------------------------------------------------------------------- | -------- | -------------------- | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                           | No       | -                    | `TAILOR_PLATFORM_PROFILE`           |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                     | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH`   |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name. Falls back to the active profile's default machine user. | No       | -                    | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--arg <ARG>`                   | `-a`  | Workflow argument (JSON string)                                             | No       | -                    | -                                   |
| `--wait`                        | `-W`  | Wait for execution to complete                                              | No       | `false`              | -                                   |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when waiting (e.g., '3s', '500ms', '1m')                   | No       | `"3s"`               | -                                   |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait (e.g., '30s', '10m')                                   | No       | `"10m"`              | -                                   |
| `--until <UNTIL>`               | `-u`  | Wait target (success, suspended, terminal)                                  | No       | `"terminal"`         | -                                   |
| `--logs`                        | `-l`  | Display job execution logs after completion                                 | No       | `false`              | -                                   |

<!-- politty:command:workflow start:options:end -->

<!-- politty:command:workflow start:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow start:global-options-link:end -->
<!-- politty:command:workflow wait:heading:start -->

### workflow wait

<!-- politty:command:workflow wait:heading:end -->

<!-- politty:command:workflow wait:description:start -->

Wait for a workflow execution.

<!-- politty:command:workflow wait:description:end -->

<!-- politty:command:workflow wait:usage:start -->

**Usage**

```
tailor-sdk workflow wait [options] <execution-id>
```

<!-- politty:command:workflow wait:usage:end -->

<!-- politty:command:workflow wait:arguments:start -->

**Arguments**

| Argument       | Description  | Required |
| -------------- | ------------ | -------- |
| `execution-id` | Execution ID | Yes      |

<!-- politty:command:workflow wait:arguments:end -->

<!-- politty:command:workflow wait:options:start -->

**Options**

| Option                          | Alias | Description                                               | Required | Default      | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------- | -------- | ------------ | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                              | No       | -            | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                         | No       | -            | `TAILOR_PLATFORM_PROFILE`      |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when waiting (e.g., '3s', '500ms', '1m') | No       | `"3s"`       | -                              |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait (e.g., '30s', '10m')                 | No       | `"10m"`      | -                              |
| `--until <UNTIL>`               | `-u`  | Wait target (success, suspended, terminal)                | No       | `"terminal"` | -                              |
| `--logs`                        | `-l`  | Display job execution logs after completion               | No       | `false`      | -                              |

<!-- politty:command:workflow wait:options:end -->

<!-- politty:command:workflow wait:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow wait:global-options-link:end -->

<!-- politty:command:workflow wait:examples:start -->

**Examples**

**Wait for workflow success**

```bash
$ tailor-sdk workflow wait execution-id --until success --timeout 10m --json
```

**Wait for a workflow wait point**

```bash
$ tailor-sdk workflow wait execution-id --until suspended --timeout 6m --logs --json
```

**Wait for success, failure, or suspension**

```bash
$ tailor-sdk workflow wait execution-id --until terminal
```

<!-- politty:command:workflow wait:examples:end -->

**Shell automation**

Capture the execution ID from `workflow start` and wait for the same run from a
separate command:

```bash
execution_id="$(
  tailor-sdk workflow start order-workflow --json | jq -r '.executionId'
)"

tailor-sdk workflow wait "$execution_id" \
  --until success \
  --timeout 10m \
  --interval 5s \
  --json
```

Wait until a workflow reaches a wait point, such as an approval step:

```bash
tailor-sdk workflow wait "$execution_id" \
  --until suspended \
  --timeout 6m \
  --logs \
  --json
```

**Programmatic API**

Use `waitWorkflowExecution` when a script already has an execution ID and needs
the same waiter behavior as the CLI:

```ts
import { waitWorkflowExecution } from "@tailor-platform/sdk/cli";

const executionId = process.env.EXECUTION_ID;

if (!executionId) {
  throw new Error("EXECUTION_ID is required");
}

const result = await waitWorkflowExecution({
  executionId,
  until: "success",
  timeout: 10 * 60 * 1000,
  interval: 5000,
});

if (result.timedOut) {
  throw new Error(`Workflow ${result.id} timed out at ${result.status}`);
}
```

<!-- politty:command:workflow executions:heading:start -->

### workflow executions

<!-- politty:command:workflow executions:heading:end -->

<!-- politty:command:workflow executions:description:start -->

List or get workflow executions.

<!-- politty:command:workflow executions:description:end -->

<!-- politty:command:workflow executions:usage:start -->

**Usage**

```
tailor-sdk workflow executions [options] [execution-id]
```

<!-- politty:command:workflow executions:usage:end -->

<!-- politty:command:workflow executions:arguments:start -->

**Arguments**

| Argument       | Description                               | Required |
| -------------- | ----------------------------------------- | -------- |
| `execution-id` | Execution ID (if provided, shows details) | No       |

<!-- politty:command:workflow executions:arguments:end -->

<!-- politty:command:workflow executions:options:start -->

**Options**

| Option                            | Alias | Description                                               | Required | Default      | Env                            |
| --------------------------------- | ----- | --------------------------------------------------------- | -------- | ------------ | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>`   | `-w`  | Workspace ID                                              | No       | -            | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`             | `-p`  | Workspace profile                                         | No       | -            | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`                 | -     | Sort order (asc or desc)                                  | No       | `"desc"`     | -                              |
| `--limit <LIMIT>`                 | `-l`  | Maximum number of items to return (0: unlimited)          | No       | `50`         | -                              |
| `--workflow-name <WORKFLOW_NAME>` | `-n`  | Filter by workflow name (list mode only)                  | No       | -            | -                              |
| `--status <STATUS>`               | `-s`  | Filter by status (list mode only)                         | No       | -            | -                              |
| `--wait`                          | `-W`  | Wait for execution to complete                            | No       | `false`      | -                              |
| `--interval <INTERVAL>`           | `-i`  | Polling interval when waiting (e.g., '3s', '500ms', '1m') | No       | `"3s"`       | -                              |
| `--timeout <TIMEOUT>`             | `-t`  | Maximum time to wait (e.g., '30s', '10m')                 | No       | `"10m"`      | -                              |
| `--until <UNTIL>`                 | `-u`  | Wait target (success, suspended, terminal)                | No       | `"terminal"` | -                              |
| `--logs`                          | -     | Display job execution logs (detail mode only)             | No       | `false`      | -                              |

<!-- politty:command:workflow executions:options:end -->

<!-- politty:command:workflow executions:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow executions:global-options-link:end -->
<!-- politty:command:workflow resume:heading:start -->

### workflow resume

<!-- politty:command:workflow resume:heading:end -->

<!-- politty:command:workflow resume:description:start -->

Resume a failed or pending workflow execution.

<!-- politty:command:workflow resume:description:end -->

<!-- politty:command:workflow resume:usage:start -->

**Usage**

```
tailor-sdk workflow resume [options] <execution-id>
```

<!-- politty:command:workflow resume:usage:end -->

<!-- politty:command:workflow resume:arguments:start -->

**Arguments**

| Argument       | Description         | Required |
| -------------- | ------------------- | -------- |
| `execution-id` | Failed execution ID | Yes      |

<!-- politty:command:workflow resume:arguments:end -->

<!-- politty:command:workflow resume:options:start -->

**Options**

| Option                          | Alias | Description                                               | Required | Default      | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------- | -------- | ------------ | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                              | No       | -            | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                         | No       | -            | `TAILOR_PLATFORM_PROFILE`      |
| `--wait`                        | `-W`  | Wait for execution to complete                            | No       | `false`      | -                              |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when waiting (e.g., '3s', '500ms', '1m') | No       | `"3s"`       | -                              |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait (e.g., '30s', '10m')                 | No       | `"10m"`      | -                              |
| `--until <UNTIL>`               | `-u`  | Wait target (success, suspended, terminal)                | No       | `"terminal"` | -                              |
| `--logs`                        | `-l`  | Display job execution logs after completion               | No       | `false`      | -                              |

<!-- politty:command:workflow resume:options:end -->

<!-- politty:command:workflow resume:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:workflow resume:global-options-link:end -->

**Usage Examples:**

```bash
# Start a workflow
tailor-sdk workflow start my-workflow -m admin-machine-user

# Start with argument
tailor-sdk workflow start my-workflow -m admin -a '{"userId": "123"}'

# Start and wait for completion
tailor-sdk workflow start my-workflow -m admin -W
```

**Usage Examples:**

```bash
# List all executions
tailor-sdk workflow executions

# Filter by workflow name
tailor-sdk workflow executions -n my-workflow

# Filter by status
tailor-sdk workflow executions -s RUNNING

# Get execution details
tailor-sdk workflow executions <execution-id>

# Get execution details with logs
tailor-sdk workflow executions <execution-id> --logs

# Wait for execution to complete
tailor-sdk workflow executions <execution-id> -W
```
