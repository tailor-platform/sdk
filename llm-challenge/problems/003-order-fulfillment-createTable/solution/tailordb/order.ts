import { createTable, timestampFields } from "@tailor-platform/sdk";
import { customer } from "./customer";

export const order = createTable(
  "Order",
  {
    customerId: { kind: "uuid", relation: { type: "n-1", toward: { type: customer } } },
    status: {
      kind: "enum",
      values: ["PLACED", "PAID", "SHIPPED", "CANCELLED"],
      optional: true,
    },
    orderCode: { kind: "string", serial: { start: 1, format: "ORD-%05d" } },
    totalAmount: { kind: "float" },
    ...timestampFields(),
  },
  {
    hooks: {
      create: ({ data }) => ({
        ...data,
        status: data.status ?? "PLACED",
      }),
    },
    validate: [[({ data }) => data.totalAmount >= 0, "totalAmount must be non-negative"]],
  },
);
