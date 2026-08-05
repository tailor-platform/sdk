import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { product } from "../../db/product";

const schemaType = t.object({
  ...product.pickFields(["id"], { optional: true }),
  ...product.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(product, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(product)),
  {
    foreignKeys: [
      {"column":"categoryId","references":{"table":"Category","column":"id"}},
    ],
    indexes: [
      {"name":"idx_status_categoryId","columns":["status","categoryId"],"unique":false},
    ],
  }
);
