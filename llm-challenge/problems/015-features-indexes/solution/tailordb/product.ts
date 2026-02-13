import { db } from "@tailor-platform/sdk";

export const product = db
  .type(["Product", "Products"], {
    name: db.string().index(),
    sku: db.string().unique(),
    price: db.float(),
    stock: db.int(),
    category: db.string(),
    isActive: db.bool(),
    ...db.fields.timestamps(),
  })
  .features({
    aggregation: true,
    bulkUpsert: true,
  })
  .indexes({
    fields: ["category", "isActive"],
    name: "idx_category_active",
  });

export type product = typeof product;
