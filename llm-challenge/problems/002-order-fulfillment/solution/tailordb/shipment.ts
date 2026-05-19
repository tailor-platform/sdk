import { db } from "@tailor-platform/sdk";
import { order } from "./order";

export const shipment = db
  .type("Shipment", {
    orderId: db.uuid().relation({ type: "n-1", toward: { type: order } }),
    trackingNumber: db.string().unique(),
    shippedAt: db.datetime(),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "_loggedIn" }, "=", true]],
    delete: [[{ user: "_loggedIn" }, "=", true]],
  });
