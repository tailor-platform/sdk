# Executor Commands

Commands for managing executors and executor jobs.

## executor

Manage executors

**Usage**

```
tailor executor [command]
```

**Commands**

| Command                                 | Description                   |
| --------------------------------------- | ----------------------------- |
| [`executor trigger`](#executor-trigger) | Trigger an executor manually. |
| [`executor jobs`](#executor-jobs)       | List or get executor jobs.    |
| [`executor list`](#executor-list)       | List all executors            |
| [`executor get`](#executor-get)         | Get executor details          |
| [`executor webhook`](#executor-webhook) | Manage executor webhooks      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### executor list

List all executors

**Usage**

```
tailor executor list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### executor get

Get executor details

**Usage**

```
tailor executor get [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Executor name | Yes      |

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### executor jobs

List or get executor jobs.

**Usage**

```
tailor executor jobs [options] <executor-name> [job-id]
```

**Arguments**

| Argument        | Description                             | Required |
| --------------- | --------------------------------------- | -------- |
| `executor-name` | Executor name                           | Yes      |
| `job-id`        | Job ID (if provided, shows job details) | No       |

**Options**

| Option                          | Alias | Description                                                                                           | Required | Default  | Env                            |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                          | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                     | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--status <STATUS>`             | `-s`  | Filter by status (PENDING, RUNNING, SUCCESS, FAILED, CANCELED) (list mode only)                       | No       | -        | -                              |
| `--attempts`                    | -     | Show job attempts (only with job ID) (detail mode only)                                               | No       | `false`  | -                              |
| `--wait`                        | `-W`  | Wait for job completion and downstream execution (workflow/function) if applicable (detail mode only) | No       | `false`  | -                              |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                                        | No       | `"3s"`   | -                              |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait when using --wait (e.g., '30s', '5m')                                            | No       | `"5m"`   | -                              |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                                                              | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | -     | Maximum number of jobs to list (0: unlimited, default: 50) (list mode only)                           | No       | `50`     | -                              |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                                    | No       | `false`  | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**List jobs for an executor (default: 50 jobs)**

```bash
$ tailor executor jobs my-executor
```

**Limit the number of jobs**

```bash
$ tailor executor jobs my-executor --limit 10
```

**Filter by status**

```bash
$ tailor executor jobs my-executor -s RUNNING
```

**Get job details**

```bash
$ tailor executor jobs my-executor <job-id>
```

**Get job details with attempts**

```bash
$ tailor executor jobs my-executor <job-id> --attempts
```

**Wait for job to complete**

```bash
$ tailor executor jobs my-executor <job-id> -W
```

**Wait for job with logs**

```bash
$ tailor executor jobs my-executor <job-id> -W -l
```

### executor trigger

Trigger an executor manually.

**Usage**

```
tailor executor trigger [options] <executor-name>
```

**Arguments**

| Argument        | Description   | Required |
| --------------- | ------------- | -------- |
| `executor-name` | Executor name | Yes      |

**Options**

| Option                          | Alias | Description                                                                        | Required | Default | Env                            |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                       | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                  | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--data <DATA>`                 | `-d`  | Request body (JSON string)                                                         | No       | -       | -                              |
| `--header <HEADER>`             | `-H`  | Request header (format: 'Key: Value', can be specified multiple times)             | No       | -       | -                              |
| `--wait`                        | `-W`  | Wait for job completion and downstream execution (workflow/function) if applicable | No       | `false` | -                              |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                     | No       | `"3s"`  | -                              |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait when using --wait (e.g., '30s', '5m')                         | No       | `"5m"`  | -                              |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                 | No       | `false` | -                              |

**Examples**

**Trigger an executor**

```bash
$ tailor executor trigger my-executor
```

**Trigger with data**

```bash
$ tailor executor trigger my-executor -d '{"message": "hello"}'
```

**Trigger with data and headers**

```bash
$ tailor executor trigger my-executor -d '{"message": "hello"}' -H "X-Custom: value" -H "X-Another: value2"
```

**Trigger and wait for completion**

```bash
$ tailor executor trigger my-executor -W
```

**Trigger, wait, and show logs**

```bash
$ tailor executor trigger my-executor -W -l
```

**Shell automation**

Trigger an executor and wait for the executor job plus any downstream workflow or
function execution:

```bash
tailor executor trigger daily-workflow \
  --wait \
  --timeout 5m \
  --interval 5s \
  --json
```

Wait for an existing job when another process already captured the job ID:

```bash
tailor executor jobs daily-workflow "$job_id" \
  --wait \
  --timeout 5m \
  --logs \
  --json
```

**Programmatic API**

Import your executor definition and pass it to the typed API:

```ts
import { triggerExecutor, watchExecutorJob } from "@tailor-platform/sdk/cli";
import dailyWorkflow from "../executors/dailyWorkflow";

const { jobId } = await triggerExecutor({
  executor: dailyWorkflow,
});

if (!jobId) {
  throw new Error("Executor trigger did not return a job ID");
}

const result = await watchExecutorJob({
  executor: dailyWorkflow,
  jobId,
  timeout: 5 * 60 * 1000,
  interval: 5000,
});

if (result.timedOut) {
  throw new Error(`Executor job ${result.job.id} timed out at ${result.job.status}`);
}
```

**Notes**

Only executors with `INCOMING_WEBHOOK` or `SCHEDULE` trigger types can be triggered manually.
Executors with `EVENT` trigger types (such as `recordCreated`, `recordUpdated`, `recordDeleted`) cannot be triggered manually.

The `--data` and `--header` options are only available for `INCOMING_WEBHOOK` trigger type.

**Downstream Execution Tracking**

When using `--wait`, the CLI tracks not only the executor job but also any downstream executions:

- **Workflow targets**: Waits for the workflow execution to complete (SUCCESS, FAILED, or PENDING_RESUME). Shows real-time status changes and currently running job names during execution (same output as `workflow start --wait`).
- **Function targets**: Waits for the function execution to complete
- **Webhook/GraphQL targets**: Only waits for the executor job itself

The `--logs` option displays logs from the downstream execution when available.

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

### executor webhook

Manage executor webhooks

**Usage**

```
tailor executor webhook [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| [`executor webhook list`](#executor-webhook-list) | List executors with incoming webhook triggers |

#### executor webhook list

List executors with incoming webhook triggers

**Usage**

```
tailor executor webhook list [options]
```

**Options**

| Option                          | Alias | Description                                              | Required | Default  | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------- | -------- | -------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                             | No       | -        | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                        | No       | -        | `TAILOR_PLATFORM_PROFILE`      |
| `--order <ORDER>`               | -     | Sort order (asc or desc)                                 | No       | `"desc"` | -                              |
| `--limit <LIMIT>`               | `-l`  | Maximum number of items to return (0 or omit: unlimited) | No       | -        | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.
