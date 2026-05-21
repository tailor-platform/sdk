import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { product } from "../../../../../tailordb/product";

const schemaType = t.object({
  ...product.pickFields(["id","createdAt"], { optional: true }),
  ...product.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(product);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, product.metadata?.validate),
  {
    foreignKeys: [
      {"column":"supplierId","references":{"table":"Supplier","column":"id"}},
    ],
    indexes: [
      {"name":"product_sku_unique_idx","columns":["sku"],"unique":true},
    ],
  }
);
