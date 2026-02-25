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
| [`workflow executions`](#workflow-executions) | List or get workflow executions.               |
| [`workflow resume`](#workflow-resume)         | Resume a failed or pending workflow execution. |

<!-- politty:command:workflow:subcommands:end -->
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

| Option                          | Alias | Description       | Required | Default |
| ------------------------------- | ----- | ----------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       |

<!-- politty:command:workflow list:options:end -->
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

| Option                          | Alias | Description       | Required | Default |
| ------------------------------- | ----- | ----------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       |

<!-- politty:command:workflow get:options:end -->
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

| Option                          | Alias | Description                                                    | Required | Default              |
| ------------------------------- | ----- | -------------------------------------------------------------- | -------- | -------------------- |
| `--json`                        | `-j`  | Output as JSON                                                 | No       | `false`              |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                   | No       | -                    |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                              | No       | -                    |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                        | No       | `"tailor.config.ts"` |
| `--machineuser <MACHINEUSER>`   | `-m`  | Machine user name                                              | Yes      | -                    |
| `--arg <ARG>`                   | `-a`  | Workflow argument (JSON string)                                | No       | -                    |
| `--wait`                        | `-W`  | Wait for execution to complete                                 | No       | `false`              |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m') | No       | `"3s"`               |
| `--logs`                        | `-l`  | Display job execution logs after completion (requires --wait)  | No       | `false`              |

<!-- politty:command:workflow start:options:end -->
<!-- politty:command:workflow executions:heading:start -->

### workflow executions

<!-- politty:command:workflow executions:heading:end -->

<!-- politty:command:workflow executions:description:start -->

List or get workflow executions.

<!-- politty:command:workflow executions:description:end -->

<!-- politty:command:workflow executions:usage:start -->

**Usage**

```
tailor-sdk workflow executions [options] [executionId]
```

<!-- politty:command:workflow executions:usage:end -->

<!-- politty:command:workflow executions:arguments:start -->

**Arguments**

| Argument      | Description                               | Required |
| ------------- | ----------------------------------------- | -------- |
| `executionId` | Execution ID (if provided, shows details) | No       |

<!-- politty:command:workflow executions:arguments:end -->

<!-- politty:command:workflow executions:options:start -->

**Options**

| Option                            | Alias | Description                                                    | Required | Default |
| --------------------------------- | ----- | -------------------------------------------------------------- | -------- | ------- |
| `--json`                          | `-j`  | Output as JSON                                                 | No       | `false` |
| `--workspace-id <WORKSPACE_ID>`   | `-w`  | Workspace ID                                                   | No       | -       |
| `--profile <PROFILE>`             | `-p`  | Workspace profile                                              | No       | -       |
| `--workflow-name <WORKFLOW_NAME>` | `-n`  | Filter by workflow name (list mode only)                       | No       | -       |
| `--status <STATUS>`               | `-s`  | Filter by status (list mode only)                              | No       | -       |
| `--wait`                          | `-W`  | Wait for execution to complete                                 | No       | `false` |
| `--interval <INTERVAL>`           | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m') | No       | `"3s"`  |
| `--logs`                          | -     | Display job execution logs (detail mode only)                  | No       | `false` |

<!-- politty:command:workflow executions:options:end -->
<!-- politty:command:workflow resume:heading:start -->

### workflow resume

<!-- politty:command:workflow resume:heading:end -->

<!-- politty:command:workflow resume:description:start -->

Resume a failed or pending workflow execution.

<!-- politty:command:workflow resume:description:end -->

<!-- politty:command:workflow resume:usage:start -->

**Usage**

```
tailor-sdk workflow resume [options] <executionId>
```

<!-- politty:command:workflow resume:usage:end -->

<!-- politty:command:workflow resume:arguments:start -->

**Arguments**

| Argument      | Description         | Required |
| ------------- | ------------------- | -------- |
| `executionId` | Failed execution ID | Yes      |

<!-- politty:command:workflow resume:arguments:end -->

<!-- politty:command:workflow resume:options:start -->

**Options**

| Option                          | Alias | Description                                                    | Required | Default |
| ------------------------------- | ----- | -------------------------------------------------------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON                                                 | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                   | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                              | No       | -       |
| `--wait`                        | `-W`  | Wait for execution to complete                                 | No       | `false` |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m') | No       | `"3s"`  |
| `--logs`                        | `-l`  | Display job execution logs after completion (requires --wait)  | No       | `false` |

<!-- politty:command:workflow resume:options:end -->

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
