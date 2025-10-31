import { db } from "@tailor-platform/tailor-sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";
import { salesOrder } from "./salesOrder";

export const invoice = db
  .type("Invoice", {
    invoiceNumber: db.string().serial({
      start: 1000,
      format: "INV-%05d",
    }),
    salesOrderID: db.uuid().relation({
      type: "1-1",
      toward: { type: salesOrder },
    }),
    amount: db.int({ optional: true }),
    sequentialId: db.int().serial({
      start: 1,
      maxValue: 999999,
    }),
    status: db.enum("draft", "sent", "paid", "cancelled", { optional: true }),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
