import { db } from "@tailor-platform/sdk";

export const order = db.type("Order", {
  customerName: db.string(),
  status: db.enum(["pending", "processing", "shipped", "delivered"]),
  totalAmount: db.float(),
  ...db.fields.timestamps(),
});

export type order = typeof order;
