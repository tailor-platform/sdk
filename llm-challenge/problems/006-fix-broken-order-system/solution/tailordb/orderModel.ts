import { db } from "@tailor-platform/sdk";

export const orderModel = db
  .type("OrderModel", {
    customerName: db.string(),
    customerEmail: db.string(),
    status: db.enum(["pending", "confirmed", "shipped", "delivered"]),
    quantity: db.int().validate([({ value }) => value > 0, "Quantity must be positive"]),
    unitPrice: db.float().validate([({ value }) => value >= 0, "Price must be non-negative"]),
    totalPrice: db.float(),
    discount: db.float({ optional: true }),
    notes: db.string({ optional: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    totalPrice: {
      create: ({ data }) => (data.quantity ?? 0) * (data.unitPrice ?? 0),
      update: ({ data }) => (data.quantity ?? 0) * (data.unitPrice ?? 0),
    },
  });
export type orderModel = typeof orderModel;
