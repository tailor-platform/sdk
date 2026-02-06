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

| Command                                 | Description                  |
| --------------------------------------- | ---------------------------- |
| [`executor list`](#executor-list)       | List all executors           |
| [`executor get`](#executor-get)         | Get executor details         |
| [`executor jobs`](#executor-jobs)       | List or get executor jobs    |
| [`executor trigger`](#executor-trigger) | Trigger an executor manually |
| [`executor webhook`](#executor-webhook) | Manage executor webhooks     |

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

List or get executor jobs

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

| Option                          | Alias | Description                                                                        | Default |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------- | ------- |
| `--json`                        | `-j`  | Output as JSON                                                                     | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                  | -       |
| `--status <STATUS>`             | `-s`  | Filter by status (PENDING, RUNNING, SUCCESS, FAILED, CANCELED)                     | -       |
| `--attempts`                    | -     | Show job attempts (only with job ID)                                               | `false` |
| `--watch`                       | -     | Wait for job completion and downstream execution (workflow/function) if applicable | `false` |
| `--interval <INTERVAL>`         | -     | Polling interval (e.g., '3s', '500ms', '1m')                                       | `"3s"`  |

<!-- politty:command:executor jobs:end -->

<!-- politty:command:executor trigger:start -->

### executor trigger

Trigger an executor manually

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
| `--payload <PAYLOAD>`           | `-d`  | Payload data (JSON string)                                                         | -       |
| `--watch`                       | -     | Wait for job completion and downstream execution (workflow/function) if applicable | `false` |
| `--interval <INTERVAL>`         | -     | Polling interval for --watch (e.g., '3s', '500ms', '1m')                           | `"3s"`  |

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
