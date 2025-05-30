import { db, t } from "@tailor-platform/tailor-sdk";
import { customer } from "./customer";

export const salesOrder = db.type(
  "SalesOrder",
  {
    customerID: db.uuid().ref(customer, ["customer", "salesOrder"]),
    totalPrice: db.int().optional(),
    discount: db.float().optional(),
    status: db.string().optional(),
    cancelReason: db.string().optional(),
    canceledAt: db.datetime().optional(),
  },
  { withTimestamps: true },
);
export type salesOrder = typeof salesOrder;
export type SalesOrder = t.infer<salesOrder>;
