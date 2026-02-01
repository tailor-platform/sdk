# Workflow Commands

Commands for managing workflows and workflow executions.

<!-- politty:command:workflow:start -->
## workflow

Manage workflows and workflow executions.

**Usage**

```
tailor-sdk workflow [command]
```

**Commands**

| Command | Description |
|---------|-------------|
| [`workflow list`](#workflow-list) | List all workflows in the workspace. |
| [`workflow get`](#workflow-get) | Get workflow details. |
| [`workflow start`](#workflow-start) | Start a workflow execution. |
| [`workflow executions`](#workflow-executions) | List or get workflow executions. |
| [`workflow resume`](#workflow-resume) | Resume a failed or pending workflow execution. |

<!-- politty:command:workflow:end -->
<!-- politty:command:workflow list:start -->
### workflow list

List all workflows in the workspace.

**Usage**

```
tailor-sdk workflow list [options]
```

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |

<!-- politty:command:workflow list:end -->
<!-- politty:command:workflow get:start -->
### workflow get

Get workflow details.

**Usage**

```
tailor-sdk workflow get [options] <name>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Workflow name | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |

<!-- politty:command:workflow get:end -->
<!-- politty:command:workflow start:start -->
### workflow start

Start a workflow execution.

**Usage**

```
tailor-sdk workflow start [options] <name>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `name` | Workflow name | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--config <CONFIG>` | `-c` | Path to SDK config file | `"tailor.config.ts"` |
| `--machineuser <MACHINEUSER>` | `-m` | Machine user name | - |
| `--arg <ARG>` | `-a` | Workflow argument (JSON string) | - |
| `--wait` | `-W` | Wait for execution to complete | `false` |
| `--interval <INTERVAL>` | `-i` | Polling interval when using --wait | `"3s"` |
| `--logs` | `-l` | Display job execution logs after completion (requires --wait) | `false` |

<!-- politty:command:workflow start:end -->
<!-- politty:command:workflow executions:start -->
### workflow executions

List or get workflow executions.

**Usage**

```
tailor-sdk workflow executions [options] [executionId]
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `executionId` | Execution ID (if provided, shows details) | No |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--workflow-name <WORKFLOW_NAME>` | `-n` | Filter by workflow name (list mode only) | - |
| `--status <STATUS>` | `-s` | Filter by status (list mode only) | - |
| `--wait` | `-W` | Wait for execution to complete | `false` |
| `--interval <INTERVAL>` | `-i` | Polling interval when using --wait | `"3s"` |
| `--logs` | - | Display job execution logs (detail mode only) | `false` |

<!-- politty:command:workflow executions:end -->
<!-- politty:command:workflow resume:start -->
### workflow resume

Resume a failed or pending workflow execution.

**Usage**

```
tailor-sdk workflow resume [options] <executionId>
```

**Arguments**

| Argument | Description | Required |
|----------|-------------|----------|
| `executionId` | Failed execution ID | Yes |

**Options**

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--json` | `-j` | Output as JSON | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w` | Workspace ID | - |
| `--profile <PROFILE>` | `-p` | Workspace profile | - |
| `--wait` | `-W` | Wait for execution to complete | `false` |
| `--interval <INTERVAL>` | `-i` | Polling interval when using --wait | `"3s"` |
| `--logs` | `-l` | Display job execution logs after completion (requires --wait) | `false` |

<!-- politty:command:workflow resume:end -->

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
