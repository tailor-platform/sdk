import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const productBundle = db
  .table("ProductBundle", "Product bundle with nested array hooks", {
    name: db.string(),
    label: db.string({ optional: true }),
    items: db.object(
      {
        productName: db.string(),
        qty: db
          .int()
          .default(1)
          .validate(({ value }) => (value <= 0 ? "qty must be positive" : undefined)),
        unitPrice: db.float(),
      },
      { array: true },
    ),
    ...db.fields.timestamps(),
  })
  .hooks({
    create: ({ input }) => ({
      label: `${input.name} Bundle`,
    }),
    update: ({ input }) => ({
      label: `${input.name} Bundle`,
    }),
  })
  .validate(({ newRecord }, issues) => {
    if (newRecord.items && newRecord.items.length === 0) {
      issues("items", "At least one item is required");
    }
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
