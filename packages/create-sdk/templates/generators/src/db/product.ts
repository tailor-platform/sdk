import { db } from "@tailor-platform/sdk";
import { category } from "./category";

export const product = db
  .type("Product", {
    name: db.string(),
    description: db.string({ optional: true }),
    price: db.float(),
    status: db.enum([
      { value: "DRAFT", description: "Not yet published" },
      { value: "ACTIVE", description: "Available for purchase" },
      { value: "DISCONTINUED", description: "No longer sold" },
    ]),
    categoryId: db.uuid({ optional: true }).relation({
      type: "n-1",
      toward: { type: category },
    }),
    ...db.fields.timestamps(),
  })
  .files({ image: "Product image" })
  .indexes({ fields: ["status", "categoryId"], unique: false })
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
