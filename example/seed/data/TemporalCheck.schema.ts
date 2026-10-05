import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { temporalCheck } from "../../tailordb/temporalCheck";

const schemaType = t.object({
  ...temporalCheck.pickFields(["id"], { optional: true }),
  ...temporalCheck.omitFields(["id"]),
});

export const hook = createTailorDBHook(temporalCheck);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, temporalCheck),
);
