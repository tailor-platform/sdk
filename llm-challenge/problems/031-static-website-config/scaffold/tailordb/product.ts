import { db } from "@tailor-platform/sdk";

export const product = db.type("Product", {
  name: db.string(),
  price: db.int(),
  ...db.fields.timestamps(),
});

export type product = typeof product;
