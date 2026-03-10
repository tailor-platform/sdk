import { t } from "@tailor-platform/sdk";
import { defineSchema, createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/seed";
import { category } from "../../db/category";

const schemaType = t.object({
  ...category.pickFields(["id"], { optional: true }),
  ...category.omitFields(["id"]),
});

const hook = createTailorDBHook(category);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"parentCategoryId","references":{"table":"Category","column":"id"}},
    ],
    indexes: [
      {"name":"category_slug_unique_idx","columns":["slug"],"unique":true},
    ],
  }
);
