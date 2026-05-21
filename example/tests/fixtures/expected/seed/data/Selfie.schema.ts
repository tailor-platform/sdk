import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { selfie } from "../../../../../tailordb/selfie";

const schemaType = t.object({
  ...selfie.pickFields(["id"], { optional: true }),
  ...selfie.omitFields(["id"]),
});

const hook = createTailorDBHook(selfie);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, selfie.metadata?.validate),
  {
    foreignKeys: [
      {"column":"parentID","references":{"table":"Selfie","column":"id"}},
      {"column":"dependId","references":{"table":"Selfie","column":"id"}},
    ],
    indexes: [
      {"name":"selfie_dependId_unique_idx","columns":["dependId"],"unique":true},
    ],
  }
);
