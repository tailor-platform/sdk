import { db } from "@tailor-platform/sdk";
import { subscription } from "./subscription";

export const invoice = db
  .type("Invoice", {
    subscriptionId: db.uuid().relation({ type: "n-1", toward: { type: subscription } }),
    invoiceNumber: db.string().serial({ start: 1, format: "INV-%06d" }),
    amount: db.float(),
    currency: db.enum(["USD", "EUR", "JPY"]),
    issuedAt: db.datetime({ optional: true }),
    dueDate: db.date(),
    paid: db.bool({ optional: true }),
    notes: db.string({ optional: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    issuedAt: { create: () => new Date() },
    paid: { create: ({ value }) => value ?? false },
  });
