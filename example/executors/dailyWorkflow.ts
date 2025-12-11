import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import sampleWorkflow from "../workflows/sample";

export default createExecutor({
  name: "daily-workflow",
  description: "Scheduled workflow executor",
  trigger: scheduleTrigger({
    cron: "0 12 * * *",
    timezone: "Asia/Tokyo",
  }),
  operation: {
    kind: "workflow",
    workflow: sampleWorkflow,
    args: () => ({ orderId: "test-order-id" }),
  },
});
