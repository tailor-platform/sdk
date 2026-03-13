# Executor Commands

Commands for managing executors and executor jobs.

<!-- politty:command:executor:heading:start -->

## executor

<!-- politty:command:executor:heading:end -->

<!-- politty:command:executor:description:start -->

Manage executors

<!-- politty:command:executor:description:end -->

<!-- politty:command:executor:usage:start -->

**Usage**

```
tailor-sdk executor [command]
```

<!-- politty:command:executor:usage:end -->

<!-- politty:command:executor:subcommands:start -->

**Commands**

| Command                                 | Description                   |
| --------------------------------------- | ----------------------------- |
| [`executor list`](#executor-list)       | List all executors            |
| [`executor get`](#executor-get)         | Get executor details          |
| [`executor jobs`](#executor-jobs)       | List or get executor jobs.    |
| [`executor trigger`](#executor-trigger) | Trigger an executor manually. |
| [`executor webhook`](#executor-webhook) | Manage executor webhooks      |

<!-- politty:command:executor:subcommands:end -->

<!-- politty:command:executor:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor:global-options-link:end -->

<!-- politty:command:executor list:heading:start -->

### executor list

<!-- politty:command:executor list:heading:end -->

<!-- politty:command:executor list:description:start -->

List all executors

<!-- politty:command:executor list:description:end -->

<!-- politty:command:executor list:usage:start -->

**Usage**

```
tailor-sdk executor list [options]
```

<!-- politty:command:executor list:usage:end -->

<!-- politty:command:executor list:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:executor list:options:end -->

<!-- politty:command:executor list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor list:global-options-link:end -->

<!-- politty:command:executor get:heading:start -->

### executor get

<!-- politty:command:executor get:heading:end -->

<!-- politty:command:executor get:description:start -->

Get executor details

<!-- politty:command:executor get:description:end -->

<!-- politty:command:executor get:usage:start -->

**Usage**

```
tailor-sdk executor get [options] <name>
```

<!-- politty:command:executor get:usage:end -->

<!-- politty:command:executor get:arguments:start -->

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Executor name | Yes      |

<!-- politty:command:executor get:arguments:end -->

<!-- politty:command:executor get:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:executor get:options:end -->

<!-- politty:command:executor get:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor get:global-options-link:end -->

<!-- politty:command:executor jobs:heading:start -->

### executor jobs

<!-- politty:command:executor jobs:heading:end -->

<!-- politty:command:executor jobs:description:start -->

List or get executor jobs.

<!-- politty:command:executor jobs:description:end -->

<!-- politty:command:executor jobs:usage:start -->

**Usage**

```
tailor-sdk executor jobs [options] <executorName> [jobId]
```

<!-- politty:command:executor jobs:usage:end -->

<!-- politty:command:executor jobs:arguments:start -->

**Arguments**

| Argument       | Description                             | Required |
| -------------- | --------------------------------------- | -------- |
| `executorName` | Executor name                           | Yes      |
| `jobId`        | Job ID (if provided, shows job details) | No       |

<!-- politty:command:executor jobs:arguments:end -->

<!-- politty:command:executor jobs:options:start -->

**Options**

| Option                          | Alias | Description                                                                                           | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                          | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                     | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--status <STATUS>`             | `-s`  | Filter by status (PENDING, RUNNING, SUCCESS, FAILED, CANCELED) (list mode only)                       | No       | -       | -                              |
| `--attempts`                    | -     | Show job attempts (only with job ID) (detail mode only)                                               | No       | `false` | -                              |
| `--wait`                        | `-W`  | Wait for job completion and downstream execution (workflow/function) if applicable (detail mode only) | No       | `false` | -                              |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                                        | No       | `"3s"`  | -                              |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                                    | No       | `false` | -                              |
| `--limit <LIMIT>`               | -     | Maximum number of jobs to list (default: 50, max: 1000) (list mode only)                              | No       | -       | -                              |

<!-- politty:command:executor jobs:options:end -->

<!-- politty:command:executor jobs:examples:start -->

**Examples**

**List jobs for an executor (default: 50 jobs)**

```bash
$ tailor-sdk executor jobs my-executor
```

**Limit the number of jobs**

```bash
$ tailor-sdk executor jobs my-executor --limit 10
```

**Filter by status**

```bash
$ tailor-sdk executor jobs my-executor -s RUNNING
```

**Get job details**

```bash
$ tailor-sdk executor jobs my-executor <job-id>
```

**Get job details with attempts**

```bash
$ tailor-sdk executor jobs my-executor <job-id> --attempts
```

**Wait for job to complete**

```bash
$ tailor-sdk executor jobs my-executor <job-id> -W
```

**Wait for job with logs**

```bash
$ tailor-sdk executor jobs my-executor <job-id> -W -l
```

<!-- politty:command:executor jobs:examples:end -->

<!-- politty:command:executor jobs:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor jobs:global-options-link:end -->

<!-- politty:command:executor trigger:heading:start -->

### executor trigger

<!-- politty:command:executor trigger:heading:end -->

<!-- politty:command:executor trigger:description:start -->

Trigger an executor manually.

<!-- politty:command:executor trigger:description:end -->

<!-- politty:command:executor trigger:usage:start -->

**Usage**

```
tailor-sdk executor trigger [options] <executorName>
```

<!-- politty:command:executor trigger:usage:end -->

<!-- politty:command:executor trigger:arguments:start -->

**Arguments**

| Argument       | Description   | Required |
| -------------- | ------------- | -------- |
| `executorName` | Executor name | Yes      |

<!-- politty:command:executor trigger:arguments:end -->

<!-- politty:command:executor trigger:options:start -->

**Options**

| Option                          | Alias | Description                                                                        | Required | Default | Env                            |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                       | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                  | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--data <DATA>`                 | `-d`  | Request body (JSON string)                                                         | No       | -       | -                              |
| `--header <HEADER>`             | `-H`  | Request header (format: 'Key: Value', can be specified multiple times)             | No       | -       | -                              |
| `--wait`                        | `-W`  | Wait for job completion and downstream execution (workflow/function) if applicable | No       | `false` | -                              |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when using --wait (e.g., '3s', '500ms', '1m')                     | No       | `"3s"`  | -                              |
| `--logs`                        | `-l`  | Display function execution logs after completion (requires --wait)                 | No       | `false` | -                              |

<!-- politty:command:executor trigger:options:end -->

<!-- politty:command:executor trigger:examples:start -->

**Examples**

**Trigger an executor**

```bash
$ tailor-sdk executor trigger my-executor
```

**Trigger with data**

```bash
$ tailor-sdk executor trigger my-executor -d '{"message": "hello"}'
```

**Trigger with data and headers**

```bash
$ tailor-sdk executor trigger my-executor -d '{"message": "hello"}' -H "X-Custom: value" -H "X-Another: value2"
```

**Trigger and wait for completion**

```bash
$ tailor-sdk executor trigger my-executor -W
```

**Trigger, wait, and show logs**

```bash
$ tailor-sdk executor trigger my-executor -W -l
```

<!-- politty:command:executor trigger:examples:end -->

<!-- politty:command:executor trigger:notes:start -->

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

<!-- politty:command:executor trigger:notes:end -->

<!-- politty:command:executor trigger:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor trigger:global-options-link:end -->

<!-- politty:command:executor webhook:heading:start -->

### executor webhook

<!-- politty:command:executor webhook:heading:end -->

<!-- politty:command:executor webhook:description:start -->

Manage executor webhooks

<!-- politty:command:executor webhook:description:end -->

<!-- politty:command:executor webhook:usage:start -->

**Usage**

```
tailor-sdk executor webhook [command]
```

<!-- politty:command:executor webhook:usage:end -->

<!-- politty:command:executor webhook:subcommands:start -->

**Commands**

| Command                                           | Description                                   |
| ------------------------------------------------- | --------------------------------------------- |
| [`executor webhook list`](#executor-webhook-list) | List executors with incoming webhook triggers |

<!-- politty:command:executor webhook:subcommands:end -->

<!-- politty:command:executor webhook:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor webhook:global-options-link:end -->

<!-- politty:command:executor webhook list:heading:start -->

#### executor webhook list

<!-- politty:command:executor webhook list:heading:end -->

<!-- politty:command:executor webhook list:description:start -->

List executors with incoming webhook triggers

<!-- politty:command:executor webhook list:description:end -->

<!-- politty:command:executor webhook list:usage:start -->

**Usage**

```
tailor-sdk executor webhook list [options]
```

<!-- politty:command:executor webhook list:usage:end -->

<!-- politty:command:executor webhook list:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default | Env                            |
| ------------------------------- | ----- | ----------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       | `TAILOR_PLATFORM_PROFILE`      |

<!-- politty:command:executor webhook list:options:end -->

<!-- politty:command:executor webhook list:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:executor webhook list:global-options-link:end -->
