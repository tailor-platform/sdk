import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { productBundle } from "../../../../../tailordb/productBundle";

const schemaType = t.object({
  ...productBundle.pickFields(["id"], { optional: true }),
  ...productBundle.omitFields(["id"]),
});

const hook = createTailorDBHook(productBundle);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
