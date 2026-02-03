# Executor Commands

Commands for managing executors and executor jobs.

<!-- politty:command:executor:start -->

## executor

Manage executors and executor jobs.

**Usage**

```
tailor-sdk executor [command]
```

**Commands**

| Command                                 | Description                   |
| --------------------------------------- | ----------------------------- |
| [`executor jobs`](#executor-jobs)       | List or get executor jobs.    |
| [`executor trigger`](#executor-trigger) | Trigger an executor manually. |

<!-- politty:command:executor:end -->
<!-- politty:command:executor trigger:start -->

### executor trigger

Trigger an executor manually.

**Usage**

```
tailor-sdk executor trigger [options] <executorName>
```

**Arguments**

| Argument       | Description   | Required |
| -------------- | ------------- | -------- |
| `executorName` | Executor name | Yes      |

**Options**

| Option                          | Alias | Description                                                                        | Default |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------- | ------- |
| `--json`                        | `-j`  | Output as JSON                                                                     | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                  | -       |
| `--data <DATA>`                 | `-d`  | Request body (JSON string)                                                         | -       |
| `--header <HEADER>`             | `-H`  | Request header (format: 'Key: Value', can be specified multiple times)             | -       |
| `--wait`                        | `-W`  | Wait for job completion and downstream execution (workflow/function) if applicable | `false` |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                     | `3000`  |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                 | `false` |

<!-- politty:command:executor trigger:end -->

Only executors with `incomingWebhook` or `schedule` trigger types can be triggered manually. Executors with `event` trigger types (such as `recordCreated`, `recordUpdated`, `recordDeleted`) cannot be triggered manually.

The `--data` and `--header` options are only available for `incomingWebhook` trigger type.

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

<!-- politty:command:executor jobs:start -->

### executor jobs

List or get executor jobs.

**Usage**

```
tailor-sdk executor jobs [options] <executorName> [jobId]
```

**Arguments**

| Argument       | Description                             | Required |
| -------------- | --------------------------------------- | -------- |
| `executorName` | Executor name                           | Yes      |
| `jobId`        | Job ID (if provided, shows job details) | No       |

**Options**

| Option                          | Alias | Description                                                                                           | Default |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- | ------- |
| `--json`                        | `-j`  | Output as JSON                                                                                        | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                          | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                     | -       |
| `--status <STATUS>`             | `-s`  | Filter by status (PENDING, RUNNING, SUCCESS, FAILED, CANCELED) (list mode only)                       | -       |
| `--attempts`                    | -     | Show job attempts (only with job ID) (detail mode only)                                               | `false` |
| `--wait`                        | `-W`  | Wait for job completion and downstream execution (workflow/function) if applicable (detail mode only) | `false` |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                                        | `3000`  |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                                    | `false` |
| `--limit <LIMIT>`               | -     | Maximum number of jobs to list (default: 50, max: 1000) (list mode only)                              | -       |

<!-- politty:command:executor jobs:end -->

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
