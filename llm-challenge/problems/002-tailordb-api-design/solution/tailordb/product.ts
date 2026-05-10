import { db } from "@tailor-platform/sdk";

export const product = db
  .type("Product", {
    name: db.string(),
    slug: db.string().unique(),
    price: db.float(),
    status: db.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    tags: db.string({ optional: true, array: true }),
    ...db.fields.timestamps(),
  })
  .hooks({
    slug: { create: ({ value }) => (value ? value.toLowerCase() : "") },
  })
  .validate({
    price: [({ value }) => value >= 0, "price must be >= 0"],
  })
  .description("Products in the catalog");
