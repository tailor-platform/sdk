import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";

export default createExecutor({
  name: "notify-external-service",
  description: "Notifies an external service when a new order is created",
  trigger: recordCreatedTrigger({
    type: order,
  }),
  operation: {
    kind: "webhook",
    url: (args) => `https://api.example.com/orders/${args.newRecord.id}`,
    requestBody: (args) => ({
      orderId: args.newRecord.id,
      customerId: args.newRecord.customerId,
      totalAmount: args.newRecord.totalAmount,
    }),
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "api-secrets", key: "external-api-token" },
    },
  },
});
