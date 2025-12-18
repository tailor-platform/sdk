# Workflow Commands

Commands for managing workflows and workflow executions.

## workflow

Manage workflows and workflow executions.

```bash
tailor-sdk workflow <subcommand> [options]
```

### workflow list

List all workflows in the workspace.

```bash
tailor-sdk workflow list [options]
```

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `--json` - Output as JSON

### workflow get

Get workflow details.

```bash
tailor-sdk workflow get <nameOrId> [options]
```

**Arguments:**

- `nameOrId` - Workflow name or ID (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `--json` - Output as JSON

### workflow start

Start a workflow execution.

```bash
tailor-sdk workflow start <nameOrId> [options]
```

**Arguments:**

- `nameOrId` - Workflow name or ID (required)

**Options:**

- `-m, --machineuser` - Machine user name (required)
- `-a, --arg` - Workflow argument (JSON string)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-c, --config` - Path to the SDK config file (default: `tailor.config.ts`)
- `-W, --wait` - Wait for execution to complete
- `--interval` - Polling interval when using --wait (default: `3s`)
- `--json` - Output as JSON

**Usage Examples:**

```bash
# Start a workflow
tailor-sdk workflow start my-workflow -m admin-machine-user

# Start with argument
tailor-sdk workflow start my-workflow -m admin -a '{"userId": "123"}'

# Start and wait for completion
tailor-sdk workflow start my-workflow -m admin -W
```

### workflow executions

List or get workflow executions.

```bash
tailor-sdk workflow executions [executionId] [options]
```

**Arguments:**

- `executionId` - Execution ID (optional, if provided shows details)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-n, --workflow-name` - Filter by workflow name (list mode only)
- `-s, --status` - Filter by status: `PENDING`, `PENDING_RESUME`, `RUNNING`, `SUCCESS`, `FAILED` (list mode only)
- `-W, --wait` - Wait for execution to complete (detail mode only)
- `--interval` - Polling interval when using --wait (default: `3s`)
- `--logs` - Display job execution logs (detail mode only)
- `--json` - Output as JSON

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

```bash
tailor-sdk workflow resume <executionId> [options]
```

**Arguments:**

- `executionId` - Failed or pending execution ID (required)

**Options:**

- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-W, --wait` - Wait for execution to complete after resuming
- `--interval` - Polling interval when using --wait (default: `3s`)
- `--json` - Output as JSON
