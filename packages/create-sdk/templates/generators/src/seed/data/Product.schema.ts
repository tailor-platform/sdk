import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { product } from "../../db/product";

const schemaType = t.object({
  ...product.pickFields(["id"], { optional: true }),
  ...product.omitFields(["id"]),
});

const hook = createTailorDBHook(product);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"categoryId","references":{"table":"Category","column":"id"}},
    ],
    indexes: [
      {"name":"idx_status_categoryId","columns":["status","categoryId"],"unique":false},
    ],
  }
);
