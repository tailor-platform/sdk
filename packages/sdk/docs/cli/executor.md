# Executor Commands

Commands for managing executors and executor jobs.

<!-- politty:command:executor:start -->

## executor

Manage executors

**Usage**

```
tailor-sdk executor [command]
```

**Commands**

| Command                                 | Description                   |
| --------------------------------------- | ----------------------------- |
| [`executor list`](#executor-list)       | List all executors            |
| [`executor get`](#executor-get)         | Get executor details          |
| [`executor jobs`](#executor-jobs)       | List or get executor jobs.    |
| [`executor trigger`](#executor-trigger) | Trigger an executor manually. |
| [`executor webhook`](#executor-webhook) | Manage executor webhooks      |

<!-- politty:command:executor:end -->

<!-- politty:command:executor list:start -->

### executor list

List all executors

**Usage**

```
tailor-sdk executor list [options]
```

**Options**

| Option                          | Alias | Description       | Default |
| ------------------------------- | ----- | ----------------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | -       |

<!-- politty:command:executor list:end -->

<!-- politty:command:executor get:start -->

### executor get

Get executor details

**Usage**

```
tailor-sdk executor get [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Executor name | Yes      |

**Options**

| Option                          | Alias | Description       | Default |
| ------------------------------- | ----- | ----------------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | -       |

<!-- politty:command:executor get:end -->

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
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                                        | `"3s"`  |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                                    | `false` |
| `--limit <LIMIT>`               | -     | Maximum number of jobs to list (default: 50, max: 1000) (list mode only)                              | -       |

<!-- politty:command:executor jobs:end -->

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
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                     | `"3s"`  |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                 | `false` |

**Notes**

Only executors with `incomingWebhook` or `schedule` trigger types can be triggered manually.
Executors with `event` trigger types (such as `recordCreated`, `recordUpdated`, `recordDeleted`) cannot be triggered manually.

The `--data` and `--header` options are only available for `incomingWebhook` trigger type.

## Downstream Execution Tracking

When using `--wait`, the CLI tracks not only the executor job but also any downstream executions:

- **Workflow targets**: Waits for the workflow execution to complete (SUCCESS, FAILED, or PENDING_RESUME). Shows real-time status changes and currently running job names during execution.
- **Function targets**: Waits for the function execution to complete
- **Webhook/GraphQL targets**: Only waits for the executor job itself

The `--logs` option displays logs from the downstream execution when available.

<!-- politty:command:executor trigger:end -->

<!-- politty:command:executor webhook:start -->

### executor webhook

Manage executor webhooks

**Usage**

```
tailor-sdk executor webhook [command]
```

**Commands**

| Command                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| [`executor webhook list`](#executor-webhook-list) | List executors with incoming webhook triggers |

<!-- politty:command:executor webhook:end -->

<!-- politty:command:executor webhook list:start -->

#### executor webhook list

List executors with incoming webhook triggers

**Usage**

```
tailor-sdk executor webhook list [options]
```

**Options**

| Option                          | Alias | Description       | Default |
| ------------------------------- | ----- | ----------------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | -       |

<!-- politty:command:executor webhook list:end -->
