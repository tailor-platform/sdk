import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { UserChangeApproval } from "../../.tailor-sdk/types/tailordb/UserChangeApproval";

const schemaType = t.object({
  ...UserChangeApproval.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeApproval.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeApproval);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
