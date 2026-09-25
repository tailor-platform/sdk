import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import cleanupWorkflow from "../workflow/cleanup";

export default createExecutor({
  name: "daily-cleanup",
  description: "Runs cleanup workflow daily at midnight",
  trigger: scheduleTrigger({
    cron: "0 0 * * *",
    timezone: "UTC",
  }),
  operation: {
    kind: "workflow",
    workflow: cleanupWorkflow,
    args: () => ({ daysOld: 30 }),
  },
});
