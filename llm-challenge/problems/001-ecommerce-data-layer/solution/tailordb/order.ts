import { db } from "@tailor-platform/sdk";
import { customer } from "./customer";

export const order = db.type(["Order", "OrderList"], {
  orderNumber: db.string().serial({ start: 1000, format: "ORD-%05d" }),
  customerId: db.uuid().relation({ type: "n-1", toward: { type: customer } }),
  status: db.enum(["pending", "processing", "shipped", "delivered", "cancelled"]),
  totalAmount: db.float({ optional: true }),
  notes: db.string({ optional: true }),
  ...db.fields.timestamps(),
});
export type order = typeof order;
