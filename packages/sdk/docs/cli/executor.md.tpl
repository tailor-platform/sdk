---
politty:
  index:
    title: "Executor Commands"
    description: "Commands for managing executors and executor jobs."
---

# Executor Commands

Commands for managing executors and executor jobs.

{{politty:command:executor:heading}}

{{politty:command:executor:description}}

{{politty:command:executor:usage}}

{{politty:command:executor:subcommands}}

{{politty:command:executor:global-options-link}}

{{politty:command:executor list:heading}}

{{politty:command:executor list:description}}

{{politty:command:executor list:usage}}

{{politty:command:executor list:options}}

{{politty:command:executor list:global-options-link}}

{{politty:command:executor get:heading}}

{{politty:command:executor get:description}}

{{politty:command:executor get:usage}}

{{politty:command:executor get:arguments}}

{{politty:command:executor get:options}}

{{politty:command:executor get:global-options-link}}

{{politty:command:executor jobs:heading}}

{{politty:command:executor jobs:description}}

{{politty:command:executor jobs:usage}}

{{politty:command:executor jobs:arguments}}

{{politty:command:executor jobs:options}}

{{politty:command:executor jobs:examples}}

{{politty:command:executor jobs:global-options-link}}

{{politty:command:executor trigger:heading}}

{{politty:command:executor trigger:description}}

{{politty:command:executor trigger:usage}}

{{politty:command:executor trigger:arguments}}

{{politty:command:executor trigger:options}}

{{politty:command:executor trigger:examples}}

**Shell automation**

Trigger an executor and wait for the executor job plus any downstream workflow or
function execution:

```bash
tailor-sdk executor trigger daily-workflow \
  --wait \
  --timeout 5m \
  --interval 5s \
  --json
```

Wait for an existing job when another process already captured the job ID:

```bash
tailor-sdk executor jobs daily-workflow "$job_id" \
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

{{politty:command:executor trigger:notes}}

{{politty:command:executor trigger:global-options-link}}

{{politty:command:executor webhook:heading}}

{{politty:command:executor webhook:description}}

{{politty:command:executor webhook:usage}}

{{politty:command:executor webhook:subcommands}}

{{politty:command:executor webhook:global-options-link}}

{{politty:command:executor webhook list:heading}}

{{politty:command:executor webhook list:description}}

{{politty:command:executor webhook list:usage}}

{{politty:command:executor webhook list:options}}

{{politty:command:executor webhook list:global-options-link}}
