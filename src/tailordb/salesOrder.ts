import { db } from "@tailor-platform/tailor-sdk";
import { customer } from "./customer";

export const salesOrder = db.type("SalesOrder", {
  customerID: db.uuid().relation({
    type: "1-n",
    toward: { type: customer },
  }),
  totalPrice: db.int().optional(),
  discount: db.float().optional(),
  status: db.string().optional(),
  cancelReason: db.string().optional(),
  canceledAt: db.datetime().optional(),
  ...db.fields.timestamps(),
});
export type salesOrder = typeof salesOrder;
