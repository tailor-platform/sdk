---
politty:
  index:
    title: "Executor Commands"
    description: "Commands for managing executors and executor jobs."
---

# Executor Commands

Commands for managing executors and executor jobs.

{{politty:command:executor}}
{{politty:command:executor list}}
{{politty:command:executor get}}
{{politty:command:executor jobs}}
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

{{politty:command:executor webhook}}
{{politty:command:executor webhook list}}
