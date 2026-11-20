---
description: "List and inspect workflows, start and wait for workflow runs, and view and resume workflow executions with the tailor CLI."
---

# Workflow Commands

Commands for managing workflows and workflow executions.

In the human-readable output of `--logs` on `workflow start`, `workflow wait`, `workflow executions`, and `workflow resume`, `[PLATFORM]` marks log lines the Platform added. See [`function logs`](./function.md#function-logs) for the `source` that `--json` reports for each log entry.

## workflow

Manage workflows and workflow executions.

**Usage**

```
tailor workflow [command]
```

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Commands**

| Command                                       | Description                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`workflow list`](#workflow-list)             | List all workflows in the workspace.                                                   |
| [`workflow get`](#workflow-get)               | Get workflow details.                                                                  |
| [`workflow start`](#workflow-start)           | Start a workflow execution.                                                            |
| [`workflow run`](#workflow-run)               | Run a workflow job with the jobs it starts, as a temporary workflow without deploying. |
| [`workflow scaffold`](#workflow-scaffold)     | Scaffold a workflow definition to run with `workflow run`.                             |
| [`workflow cleanup`](#workflow-cleanup)       | Remove the temporary resources that `workflow run` left behind.                        |
| [`workflow wait`](#workflow-wait)             | Wait for a workflow execution.                                                         |
| [`workflow executions`](#workflow-executions) | List or get workflow executions.                                                       |
| [`workflow resume`](#workflow-resume)         | Resume a failed or pending workflow execution.                                         |

### workflow list

List all workflows in the workspace.

**Usage**

```
tailor workflow list [options]
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
tailor workflow get [options] <name>
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
tailor workflow start [options] <name>
```

**Arguments**

| Argument | Description   | Required |
| -------- | ------------- | -------- |
| `name`   | Workflow name | Yes      |

**Options**

| Option                          | Alias | Description                                                                                             | Required | Default      | Env                                 |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- | -------- | ------------ | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                            | No       | -            | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                       | No       | -            | `TAILOR_PLATFORM_PROFILE`           |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file (default: the nearest tailor.config.ts in the current or a parent directory) | No       | -            | `TAILOR_CONFIG_PATH`                |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name. Falls back to the active profile's default machine user.                             | No       | -            | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--arg <ARG>`                   | `-a`  | Workflow argument (JSON string)                                                                         | No       | -            | -                                   |
| `--wait`                        | `-W`  | Wait for execution to complete                                                                          | No       | `false`      | -                                   |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when waiting (e.g., '3s', '500ms', '1m')                                               | No       | `"3s"`       | -                                   |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait (e.g., '30s', '10m')                                                               | No       | `"10m"`      | -                                   |
| `--until <UNTIL>`               | `-u`  | Wait target (success, suspended, terminal)                                                              | No       | `"terminal"` | -                                   |
| `--logs`                        | `-l`  | Display job execution logs after completion                                                             | No       | `false`      | -                                   |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Usage Examples:**

```bash
# Start a workflow
tailor workflow start my-workflow -m admin-machine-user

# Start with argument
tailor workflow start my-workflow -m admin -a '{"userId": "123"}'

# Start and wait for completion
tailor workflow start my-workflow -m admin -W
```

### workflow run

Run a workflow job with the jobs it starts, as a temporary workflow without deploying.

**Usage**

```
tailor workflow run [options] <file>
```

**Arguments**

| Argument | Description                                    | Required |
| -------- | ---------------------------------------------- | -------- |
| `file`   | Path to the file that defines the workflow job | Yes      |

**Options**

| Option                          | Alias | Description                                                                                                                                | Required | Default | Env                                 |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------- | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                                                               | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                                                          | No       | -       | `TAILOR_PLATFORM_PROFILE`           |
| `--job <JOB>`                   | -     | Workflow job to run, with the jobs it starts (matches the `name` field of createWorkflowJob). Optional when the file defines only one job. | No       | -       | -                                   |
| `--arg <ARG>`                   | `-a`  | JSON object to pass to the job as its input                                                                                                | No       | -       | -                                   |
| `--arg-file <ARG_FILE>`         | -     | Path to a JSON file holding the object to pass to the job as its input                                                                     | No       | -       | -                                   |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name for authentication. Falls back to the active profile's default machine user.                                             | No       | -       | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--interval <INTERVAL>`         | `-i`  | Polling interval when waiting, at most 1m (e.g., '3s', '500ms', '1m')                                                                      | No       | `"3s"`  | -                                   |
| `--timeout <TIMEOUT>`           | `-t`  | Maximum time to wait for the run, not a limit on its jobs; waits without a limit when omitted (e.g., '30s', '10m')                         | No       | -       | -                                   |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file (default: the nearest tailor.config.ts in the current or a parent directory)                                    | No       | -       | `TAILOR_CONFIG_PATH`                |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Run one workflow job together with the jobs it starts**

```bash
$ tailor workflow run workflows/jobs.ts --job send-report --arg '{"id":"42"}'
```

**Run a job from a file of arguments and wait up to 30 minutes for the whole run**

```bash
$ tailor workflow run workflows/jobs.ts --job process-order --arg-file ./order.json --timeout 30m
```

**Notes**

The workflow job runs as a temporary workflow, so the job you are editing runs the way it does once deployed, without a deploy. The job is the first job of the temporary workflow, and every job it starts with `.start()` is registered with it. A job that calls `.start()` is suspended until the started job finishes and then continues with its result, so work that does not fit in one job is split into jobs and carried across them. The command waits for the whole run, prints the logs of every job and the result of the first job, and removes the temporary resources afterwards.

A single job is ended by the Platform after 5 minutes, and the run is reported as failed with a timeout error. The command waits until the run ends; `--timeout` limits how long it waits, not how long the jobs may run.

The file must export workflow jobs created with `createWorkflowJob`; a file that defines no workflow job is refused. Without `--job`, the run starts from the main job of the workflow the file exports as default, or from the only job when the file defines just one; `--job` selects another job to start from. The jobs it starts run from your files, not the ones already deployed under the same names, and the jobs of files in the config's `workflow.files` can be started too. The input must be a JSON object (`null` is accepted too): unlike `function run`, a number, string, boolean, or array is refused before anything is created. `tailor workflow scaffold` scaffolds a workflow to start from.

When the wait stops (`--timeout` elapsed), the run keeps going and its temporary resources stay in place. The command prints the run ID; read the outcome with `tailor workflow executions`. `tailor workflow cleanup` removes the resources of runs that have finished, and the next `workflow run` does the same before it starts. A run that finished within the last few minutes is left alone by that automatic sweep (and by `tailor deploy`), so the command still waiting for it can read its result; `tailor workflow cleanup` removes it at once.

### workflow scaffold

Scaffold a workflow definition to run with `workflow run`.

**Usage**

```
tailor workflow scaffold <file>
```

**Arguments**

| Argument | Description                                             | Required |
| -------- | ------------------------------------------------------- | -------- |
| `file`   | Path to create the workflow file at (must end with .ts) | Yes      |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Scaffold a workflow definition**

```bash
$ tailor workflow scaffold workflows/order.ts
```

**Notes**

The scaffolded file defines two workflow jobs and a workflow: `main` starts one `sub` job for each id of its input, and the workflow runs from `main`. Run it with `tailor workflow run <file> --arg '{"ids":["a","b"]}'`.

Rename the jobs and the workflow and fill in the bodies; to deploy it, add the file to the config's `workflow.files`. An existing file is never overwritten.

### workflow cleanup

Remove the temporary resources that `workflow run` left behind.

**Usage**

```
tailor workflow cleanup [options]
```

**Options**

| Option                          | Alias | Description                                                                                                                | Required | Default | Env                            |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------------ |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                                               | No       | -       | `TAILOR_PLATFORM_WORKSPACE_ID` |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                                          | No       | -       | `TAILOR_PLATFORM_PROFILE`      |
| `--include-unlabeled`           | -     | Also remove resources named `tmp-run-…` that carry no `workflow run` label (a run that was cut off before it labeled them) | No       | `false` | -                              |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Remove the resources of finished runs**

```bash
$ tailor workflow cleanup
```

**Also remove `tmp-run-…` resources that have no label**

```bash
$ tailor workflow cleanup --include-unlabeled
```

**Notes**

Removes the workflow, job functions and functions of every `workflow run` that has finished, at once. A run that is still executing is left alone.

A resource whose name starts with `tmp-run-` but that carries no `workflow run` label is reported and left in place, because the name alone does not prove `workflow run` created it. When it is a leftover of an interrupted run, `--include-unlabeled` removes it.

### workflow wait

Wait for a workflow execution.

**Usage**

```
tailor workflow wait [options] <execution-id>
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
$ tailor workflow wait execution-id --until success --timeout 10m --json
```

**Wait for a workflow wait point**

```bash
$ tailor workflow wait execution-id --until suspended --timeout 6m --logs --json
```

**Wait for success, failure, or suspension**

```bash
$ tailor workflow wait execution-id --until terminal
```

**Shell automation**

Capture the execution ID from `workflow start` and wait for the same run from a
separate command:

```bash
execution_id="$(
  tailor workflow start order-workflow --json | jq -r '.executionId'
)"

tailor workflow wait "$execution_id" \
  --until success \
  --timeout 10m \
  --interval 5s \
  --json
```

Wait until a workflow reaches a wait point, such as an approval step:

```bash
tailor workflow wait "$execution_id" \
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
tailor workflow executions [options] [execution-id]
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
tailor workflow executions

# Filter by workflow name
tailor workflow executions -n my-workflow

# Filter by status
tailor workflow executions -s RUNNING

# Get execution details
tailor workflow executions <execution-id>

# Get execution details with logs
tailor workflow executions <execution-id> --logs

# Wait for execution to complete
tailor workflow executions <execution-id> -W
```

Without `-n`, the list covers every workflow in the workspace. Executions of different workflows are interleaved by start time, or by finish time for one that finished without starting, while each workflow's executions keep their creation order. An execution that has neither started nor finished counts as newer than every started or finished one. In a workspace with many workflows this takes longer; pass `-n` to list one workflow's executions.

### workflow resume

Resume a failed or pending workflow execution.

**Usage**

```
tailor workflow resume [options] <execution-id>
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
