import { db } from "@tailor-platform/sdk";

export const order = db
  .table("Order", {
    customerName: db.string(),
    amount: db.int(),
    status: db.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]),
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
