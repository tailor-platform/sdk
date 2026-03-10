import { db } from "@tailor-platform/sdk";
import { product } from "./product";
import { user } from "./user";

export const order = db
  .type("Order", {
    productId: db.uuid().relation({
      type: "n-1",
      toward: { type: product },
    }),
    userId: db.uuid().relation({
      type: "n-1",
      toward: { type: user },
    }),
    quantity: db.int(),
    totalPrice: db.float(),
    status: db.enum([
      { value: "PENDING", description: "Awaiting confirmation" },
      { value: "CONFIRMED", description: "Order confirmed" },
      { value: "SHIPPED", description: "In transit" },
      { value: "DELIVERED", description: "Successfully delivered" },
      { value: "CANCELLED", description: "Order cancelled" },
    ]),
    ...db.fields.timestamps(),
  })
  .permission({
    create: [[{ user: "_loggedIn" }, "=", true]],
    read: [[{ user: "_loggedIn" }, "=", true]],
    update: [[{ user: "_loggedIn" }, "=", true]],
    delete: [[{ user: "_loggedIn" }, "=", true]],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: "all",
      permit: true,
    },
  ]);
