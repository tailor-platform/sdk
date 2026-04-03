import { createTable, timestampFields } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";
import { supplier } from "./supplier";

export const product = createTable(
  "Product",
  {
    name: { kind: "string", description: "Product name" },
    sku: { kind: "string", unique: true, description: "Stock keeping unit" },
    price: { kind: "float" },
    stock: { kind: "int", index: true },
    category: { kind: "enum", values: ["electronics", "clothing", "food"] },
    supplierId: {
      kind: "uuid",
      relation: {
        type: "n-1",
        toward: { type: supplier },
      },
    },
    ...timestampFields(),
  },
  {
    description: "Product catalog entry",
    permission: defaultPermission,
    gqlPermission: defaultGqlPermission,
  },
);
export type product = typeof product;
