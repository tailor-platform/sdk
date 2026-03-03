import { db } from "@tailor-platform/sdk";

export const order = db.type("Order", {
  customerName: db.string(),
  status: db.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
  totalAmount: db.float(),
  shippingAddress: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

export type order = typeof order;
