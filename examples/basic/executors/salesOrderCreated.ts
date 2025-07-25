import {
  createExecutor,
  recordCreatedTrigger,
} from "@tailor-platform/tailor-sdk";
import { salesOrder } from "../tailordb/salesOrder";

export default createExecutor(
  "sales-order-created",
  "Triggered when a new sales order is created",
)
  .on(
    recordCreatedTrigger(
      salesOrder,
      ({ newRecord }) => (newRecord.totalPrice ?? 0) > 100_0000,
    ),
  )
  .executeWebhook({
    url: ({ newRecord }) => `https://example.com/webhook/${newRecord.id}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "my-vault", key: "my-secret" },
    },
    body: ({ newRecord }) => ({
      orderId: newRecord.id,
      customerID: newRecord.customerID,
      totalPrice: newRecord.totalPrice,
    }),
  });
