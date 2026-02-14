import { db } from "@tailor-platform/sdk";

export const product = db
  .type(["Product", "Products"], {
    name: db.string().index(),
    sku: db.string().unique(),
    price: db.float(),
    stock: db.int(),
    category: db.string(),
    isActive: db.bool(),
    ownerId: db.uuid(),
    isPublic: db.bool(),
    ...db.fields.timestamps(),
  })
  .features({
    aggregation: true,
    bulkUpsert: true,
  })
  .indexes({
    fields: ["category", "isActive"],
    name: "idx_category_active",
  })
  .permission({
    create: [
      {
        conditions: [[{ user: "_loggedIn" }, "=", true]],
        permit: true,
      },
    ],
    read: [
      {
        conditions: [[{ record: "isPublic" }, "=", true]],
        permit: true,
      },
      {
        conditions: [[{ record: "ownerId" }, "=", { user: "id" }]],
        permit: true,
      },
    ],
    update: [
      {
        conditions: [[{ newRecord: "ownerId" }, "=", { user: "id" }]],
        permit: true,
      },
    ],
    delete: [
      {
        conditions: [[{ record: "ownerId" }, "=", { user: "id" }]],
        permit: true,
      },
    ],
  })
  .gqlPermission([
    {
      conditions: [[{ user: "_loggedIn" }, "=", true]],
      actions: ["read", "create"],
      permit: true,
    },
    {
      conditions: [],
      actions: "all",
      permit: true,
    },
  ]);

export type product = typeof product;
