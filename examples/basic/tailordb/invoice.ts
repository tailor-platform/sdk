import { db } from "@tailor-platform/tailor-sdk";
import { salesOrder } from "./salesOrder";
import {
  defaultGqlPermission,
  defaultPermission,
  PermissionUser,
} from "./permissions";

export const invoice = db
  .type("Invoice", {
    invoiceNumber: db.string({ optional: true }).serial({
      start: 1000,
      format: "INV-%05d",
    }),
    salesOrderID: db.uuid().relation({
      type: "1-1",
      toward: { type: salesOrder },
    }),
    amount: db.int({ optional: true }),
    sequentialId: db.int({ optional: true }).serial({
      start: 1,
      maxValue: 999999,
    }),
    status: db.enum("draft", "sent", "paid", "cancelled", { optional: true }),
    ...db.fields.timestamps(),
  })
  .permission<PermissionUser>(defaultPermission)
  .gqlPermission(defaultGqlPermission);
