import { db } from "@tailor-platform/sdk";

export const user = db
  .type("User", {
    name: db.string(),
    email: db.string().unique(),
    age: db.int(),
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
