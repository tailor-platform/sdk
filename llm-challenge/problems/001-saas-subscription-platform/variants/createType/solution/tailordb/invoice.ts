import { createType, timestampFields } from "@tailor-platform/sdk";
import { subscription } from "./subscription";

export const invoice = createType("Invoice", {
  subscriptionId: {
    kind: "uuid",
    relation: { type: "n-1", toward: { type: subscription } },
  },
  invoiceNumber: { kind: "string", serial: { start: 1, format: "INV-%06d" } },
  amount: { kind: "float" },
  currency: { kind: "enum", values: ["USD", "EUR", "JPY"] },
  issuedAt: { kind: "datetime", hooks: { create: () => new Date() } },
  dueDate: { kind: "date" },
  paid: { kind: "bool", optional: true, hooks: { create: ({ value }) => value ?? false } },
  notes: { kind: "string", optional: true },
  ...timestampFields(),
});
export type invoice = typeof invoice;
