import { t } from "@tailor-platform/sdk";
import { defineSchema, createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/seed";
import { supplier } from "../../tailordb/supplier";

const schemaType = t.object({
  ...supplier.pickFields(["id","createdAt"], { optional: true }),
  ...supplier.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(supplier);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
