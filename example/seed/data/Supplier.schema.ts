import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { supplier } from "../../tailordb/supplier";

const schemaType = t.object({
  ...supplier.pickFields(["id"], { optional: true }),
  ...supplier.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(supplier, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(supplier)),
);
