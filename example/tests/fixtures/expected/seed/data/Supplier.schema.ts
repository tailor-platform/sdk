import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { supplier } from "../../../../../tailordb/supplier";

const schemaType = t.object({
  ...supplier.pickFields(["id","createdAt"], { optional: true }),
  ...supplier.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(supplier);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
