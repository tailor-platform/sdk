import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { UserChangeRequest } from "../../.tailor-sdk/types/tailordb/UserChangeRequest";

const schemaType = t.object({
  ...UserChangeRequest.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeRequest.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeRequest);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
