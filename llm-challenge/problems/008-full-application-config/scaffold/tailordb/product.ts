import { db } from "@tailor-platform/sdk";

export const product = db.type("Product", {
  name: db.string(),
  price: db.float(),
  sku: db.string().unique(),
  ...db.fields.timestamps(),
});

export type product = typeof product;
