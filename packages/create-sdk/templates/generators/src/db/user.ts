import { db } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string().unique(),
    role: db.enum([
      { value: "ADMIN", description: "Administrator with full access" },
      { value: "MEMBER", description: "Regular team member" },
      { value: "VIEWER", description: "Read-only access" },
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
