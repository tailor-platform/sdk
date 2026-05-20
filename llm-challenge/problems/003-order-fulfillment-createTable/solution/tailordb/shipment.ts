import { createTable, timestampFields } from "@tailor-platform/sdk";
import { order } from "./order";

export const shipment = createTable(
  "Shipment",
  {
    orderId: { kind: "uuid", relation: { type: "n-1", toward: { type: order } } },
    trackingNumber: { kind: "string", unique: true },
    shippedAt: { kind: "datetime" },
    ...timestampFields(),
  },
  {
    permission: {
      create: [[{ user: "_loggedIn" }, "=", true]],
      read: [[{ user: "_loggedIn" }, "=", true]],
      update: [[{ user: "_loggedIn" }, "=", true]],
      delete: [[{ user: "_loggedIn" }, "=", true]],
    },
  },
);
