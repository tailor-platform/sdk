import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";

export default createExecutor({
  name: "order-created-notify",
  description: "Sends webhook notification when high-value order is created",
  trigger: recordCreatedTrigger({
    type: order,
    condition: ({ newRecord }) => newRecord.totalAmount > 100,
  }),
  operation: {
    kind: "webhook",
    url: ({ newRecord }) => `https://api.notifications.example.com/orders/${newRecord.id}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "notification-service", key: "api-key" },
    },
    requestBody: ({ newRecord }) => ({
      orderId: newRecord.id,
      customerName: newRecord.customerName,
      totalAmount: newRecord.totalAmount,
    }),
  },
});
