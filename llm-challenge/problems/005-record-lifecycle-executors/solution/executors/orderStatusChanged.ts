import { createExecutor, recordUpdatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";

export default createExecutor({
  name: "order-status-changed",
  description: "Triggered when an order status changes",
  trigger: recordUpdatedTrigger({
    type: order,
    condition: ({ newRecord, oldRecord }) => newRecord.status !== oldRecord.status,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord, oldRecord }) => {
      console.log(`Order status changed from ${oldRecord.status} to ${newRecord.status}`);
    },
  },
});
