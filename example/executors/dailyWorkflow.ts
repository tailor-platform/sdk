import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import sampleWorkflow from "../workflows/sample";

export default createExecutor({
  name: "user-created",
  description: "Triggered when a new user is created",
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
