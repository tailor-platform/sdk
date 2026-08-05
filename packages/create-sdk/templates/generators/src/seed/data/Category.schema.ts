import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { category } from "../../db/category";

const schemaType = t.object({
  ...category.pickFields(["id"], { optional: true }),
  ...category.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(category, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(category)),
  {
    foreignKeys: [
      {"column":"parentCategoryId","references":{"table":"Category","column":"id"}},
    ],
    indexes: [
      {"name":"category_slug_unique_idx","columns":["slug"],"unique":true},
    ],
  }
);
