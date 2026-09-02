import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { auditTrail } from "../../../../../tailordb/auditTrail";

const schemaType = t.object({
  ...auditTrail.pickFields(["id"], { optional: true }),
  ...auditTrail.omitFields(["id"]),
});

export const hook = createTailorDBHook(auditTrail);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, auditTrail),
);
