# Workflow Commands

Commands for managing workflows and workflow executions.

## workflow

Manage workflows and workflow executions.

**Usage**

```
tailor-sdk workflow [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                       | Description                                    |
| --------------------------------------------- | ---------------------------------------------- |
| [`workflow list`](#workflow-list)             | List all workflows in the workspace.           |
| [`workflow get`](#workflow-get)               | Get workflow details.                          |
| [`workflow start`](#workflow-start)           | Start a workflow execution.                    |
| [`workflow wait`](#workflow-wait)             | Wait for a workflow execution.                 |
| [`workflow executions`](#workflow-executions) | List or get workflow executions.               |
| [`workflow resume`](#workflow-resume)         | Resume a failed or pending workflow execution. |

### workflow list

List all workflows in the workspace.

**Usage**

```
tailor-sdk workflow list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workflow get

Get workflow details.

**Usage**

```
tailor-sdk workflow get [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### workflow start

Start a workflow execution.

**Usage**

```
tailor-sdk workflow start [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Usage Examples:**

```bash
# Start a workflow
tailor-sdk workflow start my-workflow -m admin-machine-user

# Start with argument
tailor-sdk workflow start my-workflow -m admin -a '{"userId": "123"}'

# Start and wait for completion
tailor-sdk workflow start my-workflow -m admin -W
```

### workflow wait

Wait for a workflow execution.

**Usage**

```
tailor-sdk workflow wait [options] <execution-id>
```

**Arguments**

| Argument       | Description  | Required |
| -------------- | ------------ | -------- |
| `execution-id` | Execution ID | Yes      |

**Options**

| Option                          | Alias | Description                                               | Required | Default      | Env                            |
| ------------------------------- | ----- | --------------------------------------------------------- | -------- | ------------ | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                              | No       | -            | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                         | No       | -            | `TAILOR_PLATFORM_PROFILE`      |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when waiting (e.g., '3s', '500ms', '1m') | No       | `"3s"`       | -                              |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait (e.g., '30s', '10m')                 | No       | `"10m"`      | -                              |
| `--until <UNTIL>`               | `-u`  | Wait target (success, suspended, terminal)                | No       | `"terminal"` | -                              |
| `--logs`                        | `-l`  | Display job execution logs after completion               | No       | `false`      | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

### workflow executions

List or get workflow executions.

**Usage**

```
tailor-sdk workflow executions [options] [execution-id]
```

**Arguments**

| Argument       | Description                               | Required |
| -------------- | ----------------------------------------- | -------- |
| `execution-id` | Execution ID (if provided, shows details) | No       |

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

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

### workflow resume

Resume a failed or pending workflow execution.

**Usage**

```
tailor-sdk workflow resume [options] <execution-id>
```

**Arguments**

| Argument       | Description         | Required |
| -------------- | ------------------- | -------- |
| `execution-id` | Failed execution ID | Yes      |

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

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
