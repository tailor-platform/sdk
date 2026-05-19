import { db } from "@tailor-platform/sdk";
import { customer } from "./customer";

export const order = db
  .type("Order", {
    customerId: db.uuid().relation({ type: "n-1", toward: { type: customer } }),
    status: db.enum(["PLACED", "PAID", "SHIPPED", "CANCELLED"], { optional: true }),
    orderCode: db.string().serial({ start: 1, format: "ORD-%05d" }),
    totalAmount: db.float(),
    ...db.fields.timestamps(),
  })
  .hooks({
    status: {
      create: ({ value }) => value ?? "PLACED",
    },
  })
  .validate({
    totalAmount: [({ value }) => value >= 0, "totalAmount must be non-negative"],
  });
