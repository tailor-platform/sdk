---
politty:
  index:
    title: "Workflow Commands"
    description: "Commands for managing workflows and executions."
---

# Workflow Commands

Commands for managing workflows and workflow executions.

{{politty:command:workflow:heading}}

{{politty:command:workflow:description}}

{{politty:command:workflow:usage}}

{{politty:command:workflow:subcommands}}

{{politty:command:workflow:global-options-link}}
{{politty:command:workflow list:heading}}

{{politty:command:workflow list:description}}

{{politty:command:workflow list:usage}}

{{politty:command:workflow list:options}}

{{politty:command:workflow list:global-options-link}}
{{politty:command:workflow get:heading}}

{{politty:command:workflow get:description}}

{{politty:command:workflow get:usage}}

{{politty:command:workflow get:arguments}}

{{politty:command:workflow get:options}}

{{politty:command:workflow get:global-options-link}}
{{politty:command:workflow start:heading}}

{{politty:command:workflow start:description}}

{{politty:command:workflow start:usage}}

{{politty:command:workflow start:arguments}}

{{politty:command:workflow start:options}}

{{politty:command:workflow start:global-options-link}}
{{politty:command:workflow wait:heading}}

{{politty:command:workflow wait:description}}

{{politty:command:workflow wait:usage}}

{{politty:command:workflow wait:arguments}}

{{politty:command:workflow wait:options}}

{{politty:command:workflow wait:global-options-link}}

{{politty:command:workflow wait:examples}}

**Shell automation**

Capture the execution ID from `workflow start` and wait for the same run from a
separate command:

```bash
execution_id="$(
  tailor-sdk workflow start order-workflow --json | jq -r '.executionId'
)"

tailor-sdk workflow wait "$execution_id" \
  --until success \
  --timeout 10m \
  --interval 5s \
  --json
```

Wait until a workflow reaches a wait point, such as an approval step:

```bash
tailor-sdk workflow wait "$execution_id" \
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

{{politty:command:workflow executions:heading}}

{{politty:command:workflow executions:description}}

{{politty:command:workflow executions:usage}}

{{politty:command:workflow executions:arguments}}

{{politty:command:workflow executions:options}}

{{politty:command:workflow executions:global-options-link}}
{{politty:command:workflow resume:heading}}

{{politty:command:workflow resume:description}}

{{politty:command:workflow resume:usage}}

{{politty:command:workflow resume:arguments}}

{{politty:command:workflow resume:options}}

{{politty:command:workflow resume:global-options-link}}

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
