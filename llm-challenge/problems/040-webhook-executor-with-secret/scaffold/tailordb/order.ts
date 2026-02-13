import { db } from "@tailor-platform/sdk";

export const order = db.type("Order", {
  customerId: db.uuid(),
  totalAmount: db.float(),
  status: db.enum(["pending", "confirmed", "shipped"]),
  ...db.fields.timestamps(),
});

export type order = typeof order;
