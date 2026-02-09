import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "@tailor-platform/sdk/changeset-plugin";
import { user } from "../../tailordb/user";

const UserChangeApproval = getGeneratedType(user, "approval");

const schemaType = t.object({
  ...UserChangeApproval.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeApproval.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeApproval);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"request","references":{"table":"UserChangeRequest","column":"id"}},
    ],
  }
);
