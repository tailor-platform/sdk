import { db } from "@tailor-platform/sdk";
import { order } from "./order";

export const orderItem = db
  .type("OrderItem", {
    orderId: db.uuid().relation({ type: "n-1", toward: { type: order } }),
    sku: db.string(),
    unitPrice: db.float(),
    quantity: db.int(),
    ...db.fields.timestamps(),
  })
  .validate({
    quantity: [({ value }) => value > 0, "quantity must be positive"],
    unitPrice: [({ value }) => value >= 0, "unitPrice must be non-negative"],
  });
