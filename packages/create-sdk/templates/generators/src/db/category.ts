import { db } from "@tailor-platform/sdk";

export const category = db
  .table("Category", {
    name: db.string(),
    slug: db.string().unique(),
    parentCategoryId: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: "self" },
      backward: "children",
    }),
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
