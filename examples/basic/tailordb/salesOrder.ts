import { db } from "@tailor-platform/tailor-sdk";
import { customer } from "./customer";
import { user } from "./user";

export const salesOrder = db
  .type(["SalesOrder", "SalesOrderList"], {
    customerID: db.uuid().relation({
      type: "n-1",
      toward: { type: customer },
    }),
    approvedByUserIDs: db
      .uuid()
      .optional()
      .relation({
        type: "keyOnly",
        toward: { type: user },
      })
      .array(),
    totalPrice: db.int().optional(),
    discount: db.float().optional(),
    status: db.string().optional(),
    cancelReason: db.string().optional(),
    canceledAt: db.datetime().optional(),
    ...db.fields.timestamps(),
  })
  .indexes(
    { fields: ["status", "createdAt"], unique: false },
    { fields: ["customerID", "status"], unique: false },
  );
export type salesOrder = typeof salesOrder;
