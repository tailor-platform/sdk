import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { UserChangeStep } from "../../tailordb/user";

const schemaType = t.object({
  ...UserChangeStep.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeStep.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeStep);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
