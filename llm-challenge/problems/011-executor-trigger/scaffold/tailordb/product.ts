import { db } from "@tailor-platform/sdk";

export const product = db.type("Product", {
  name: db.string(),
  price: db.int(),
  inStock: db.bool(),
  ...db.fields.timestamps(),
});

export type product = typeof product;
