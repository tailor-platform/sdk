# Executor Commands

Commands for managing executors and executor jobs.

## executor

Manage executors and executor jobs.

```bash
tailor-sdk executor <subcommand> [options]
```

### executor trigger

Trigger an executor manually.

Only executors with `incomingWebhook` or `schedule` trigger types can be triggered manually. Executors with `event` trigger types (such as `recordCreated`, `recordUpdated`, `recordDeleted`) cannot be triggered manually.

The `--data` and `--header` options are only available for `incomingWebhook` trigger type.

```bash
tailor-sdk executor trigger <executorName> [options]
```

**Arguments:**

- `executorName` - Executor name (required)

**Options:**

- `-d, --data` - Request body (JSON string)
- `-H, --header` - Request header (format: `Key: Value`, can be specified multiple times)
- `-W, --wait` - Wait for job completion and downstream execution (workflow/function) if applicable
- `-i, --interval` - Polling interval when using --wait (default: `3s`)
- `-l, --logs` - Display function execution logs after completion (requires --wait)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

**Usage Examples:**

```bash
# Trigger an executor
tailor-sdk executor trigger my-executor

# Trigger with data
tailor-sdk executor trigger my-executor -d '{"message": "hello"}'

# Trigger with data and headers
tailor-sdk executor trigger my-executor -d '{"message": "hello"}' -H "X-Custom: value" -H "X-Another: value2"

# Trigger and wait for completion
tailor-sdk executor trigger my-executor -W

# Trigger, wait, and show logs
tailor-sdk executor trigger my-executor -W -l
```

### executor jobs

List or get executor jobs.

```bash
tailor-sdk executor jobs <executorName> [jobId] [options]
```

**Arguments:**

- `executorName` - Executor name (required)
- `jobId` - Job ID (optional, if provided shows job details)

**Options:**

- `-s, --status` - Filter by status: `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELED` (list mode only)
- `--limit` - Maximum number of jobs to list (default: `50`, max: `1000`) (list mode only)
- `--attempts` - Show job attempts (detail mode only)
- `-W, --wait` - Wait for job completion and downstream execution (detail mode only)
- `-i, --interval` - Polling interval when using --wait (default: `3s`)
- `-l, --logs` - Display function execution logs after completion (requires --wait)
- `-w, --workspace-id` - ID of the workspace
- `-p, --profile` - Workspace profile to use
- `-j, --json` - Output as JSON

**Usage Examples:**

```bash
# List jobs for an executor (default: 50 jobs)
tailor-sdk executor jobs my-executor

# Limit the number of jobs
tailor-sdk executor jobs my-executor --limit 10

# Filter by status
tailor-sdk executor jobs my-executor -s RUNNING

# Get job details
tailor-sdk executor jobs my-executor <job-id>

# Get job details with attempts
tailor-sdk executor jobs my-executor <job-id> --attempts

# Wait for job to complete
tailor-sdk executor jobs my-executor <job-id> -W

# Wait for job with logs
tailor-sdk executor jobs my-executor <job-id> -W -l
```

## Downstream Execution Tracking

When using `--wait`, the CLI tracks not only the executor job but also any downstream executions:

- **Workflow targets**: Waits for the workflow execution to complete (SUCCESS, FAILED, or PENDING_RESUME). Shows real-time status changes and currently running job names during execution (same output as `workflow start --wait`).
- **Function targets**: Waits for the function execution to complete
- **Webhook/GraphQL targets**: Only waits for the executor job itself

The `--logs` option displays logs from the downstream execution when available.
