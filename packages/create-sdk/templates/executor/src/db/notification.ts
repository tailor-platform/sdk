import { db } from "@tailor-platform/sdk";
import { user } from "./user";

export const notification = db
  .table("Notification", {
    userId: db.uuid().relation({
      type: "n-1",
      toward: { type: user },
    }),
    title: db.string(),
    body: db.string(),
    isRead: db.bool(),
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
