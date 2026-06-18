import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { supplier } from "../../tailordb/supplier";

const schemaType = t.object({
  ...supplier.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...supplier.omitFields(["id","createdAt","updatedAt"]),
});

const hook = createTailorDBHook(supplier);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
