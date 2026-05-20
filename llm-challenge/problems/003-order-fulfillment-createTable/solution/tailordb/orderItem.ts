import { createTable, timestampFields } from "@tailor-platform/sdk";
import { order } from "./order";

export const orderItem = createTable(
  "OrderItem",
  {
    orderId: { kind: "uuid", relation: { type: "n-1", toward: { type: order } } },
    sku: { kind: "string" },
    unitPrice: { kind: "float" },
    quantity: { kind: "int" },
    ...timestampFields(),
  },
  {
    validate: [
      [({ data }) => data.quantity > 0, "quantity must be positive"],
      [({ data }) => data.unitPrice >= 0, "unitPrice must be non-negative"],
    ],
  },
);
