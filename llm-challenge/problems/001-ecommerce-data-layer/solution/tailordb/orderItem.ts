import { db } from "@tailor-platform/sdk";
import { order } from "./order";
import { product } from "./product";

export const orderItem = db
  .type("OrderItem", {
    orderId: db.uuid().relation({ type: "n-1", toward: { type: order } }),
    productId: db.uuid().relation({ type: "n-1", toward: { type: product } }),
    quantity: db.int().validate([({ value }) => value > 0, "Must be positive"]),
    unitPrice: db.float().validate([({ value }) => value >= 0, "Must be non-negative"]),
    lineTotal: db.float(),
    ...db.fields.timestamps(),
  })
  .hooks({
    lineTotal: {
      create: ({ data }) => (data.quantity ?? 0) * (data.unitPrice ?? 0),
    },
  });
export type orderItem = typeof orderItem;
