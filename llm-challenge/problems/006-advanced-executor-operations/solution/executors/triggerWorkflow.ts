import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";
import processOrderWorkflow from "../workflows/processOrder";

export default createExecutor({
  name: "order-created-trigger-workflow",
  description: "Triggers order processing workflow when a new order is created",
  trigger: recordCreatedTrigger({
    type: order,
  }),
  operation: {
    kind: "workflow",
    workflow: processOrderWorkflow,
    args: (triggerArgs) => ({ orderId: triggerArgs.newRecord.id }),
  },
});
