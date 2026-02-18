import { db } from "@tailor-platform/sdk";

export const invoice = db
  .type("Invoice", {
    invoiceNumber: db.string().serial({
      start: 1,
      format: "INV-{:05d}",
    }),
    sequenceId: db.int().serial({
      start: 1000,
      maxValue: 99999,
    }),
    customerEmail: db.string(),
    amount: db.float(),
    status: db.enum(["draft", "sent", "paid", "overdue"]),
    ...db.fields.timestamps(),
  })
  .hooks({
    customerEmail: {
      create: ({ value }) => (value !== null ? value.toLowerCase() : ""),
      update: ({ value }) => (value !== null ? value.toLowerCase() : ""),
    },
  });

export type invoice = typeof invoice;
