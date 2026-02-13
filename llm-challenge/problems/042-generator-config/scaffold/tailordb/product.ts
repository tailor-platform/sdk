import { db } from "@tailor-platform/sdk";

export const product = db.type("Product", {
  name: db.string(),
  price: db.float(),
  category: db.enum(["electronics", "clothing", "food", "other"]),
  ...db.fields.timestamps(),
});

export type product = typeof product;
