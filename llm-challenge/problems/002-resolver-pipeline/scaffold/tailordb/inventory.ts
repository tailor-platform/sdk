import { db } from "@tailor-platform/sdk";

export const inventory = db.type("Inventory", {
  name: db.string(),
  category: db.string(),
  stock: db.int(),
  price: db.float(),
  ...db.fields.timestamps(),
});

export type inventory = typeof inventory;
