import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { productBundle } from "../../tailordb/productBundle";

const schemaType = t.object({
  ...productBundle.pickFields(["id"], { optional: true }),
  ...productBundle.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(productBundle, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(productBundle)),
);
