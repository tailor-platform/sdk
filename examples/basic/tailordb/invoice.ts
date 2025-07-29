import { db } from "@tailor-platform/tailor-sdk";
import { salesOrder } from "./salesOrder";

export const invoice = db.type("Invoice", {
  invoiceNumber: db
    .string()
    .serial({
      start: 1000,
      format: "INV-%05d",
    })
    .optional(),
  salesOrderID: db.uuid().relation({
    type: "1-1",
    toward: { type: salesOrder },
  }),
  amount: db.int().optional(),
  sequentialId: db
    .int()
    .serial({
      start: 1,
      maxValue: 999999,
    })
    .optional(),
  status: db.enum("draft", "sent", "paid", "cancelled").optional(),
  ...db.fields.timestamps(),
});
export type invoice = typeof invoice;
