import { db } from "@tailor-platform/sdk";

export const product = db
  .type(["Product", "ProductCatalog"], {
    name: db.string(),
    description: db.string({ optional: true }),
    price: db.float().validate([({ value }) => value >= 0, "Must be non-negative"]),
    sku: db.string().serial({ start: 1, format: "SKU-%04d" }),
    category: db.enum(["electronics", "clothing", "food", "books", "other"]),
    inStock: db.bool({ optional: true }),
    contactEmail: db.string({ optional: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    contactEmail: {
      create: ({ data }) => (data.contactEmail ? data.contactEmail.toLowerCase() : ""),
    },
  });
export type product = typeof product;
