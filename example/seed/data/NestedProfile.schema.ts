import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { nestedProfile } from "../../tailordb/nested";

const schemaType = t.object({
  ...nestedProfile.pickFields(["id","createdAt"], { optional: true }),
  ...nestedProfile.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(nestedProfile);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
