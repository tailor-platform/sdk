import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { user } from "../../../../../tailordb/user";

const schemaType = t.object({
  ...user.pickFields(["id","createdAt"], { optional: true }),
  ...user.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(user);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, user.metadata?.validate),
  {
    foreignKeys: [
      {"column":"email","references":{"table":"_User","column":"name"}},
    ],
    indexes: [
      {"name":"user_email_unique_idx","columns":["email"],"unique":true},
      {"name":"idx_name_department","columns":["name","department"],"unique":false},
      {"name":"user_status_created_idx","columns":["status","createdAt"],"unique":false},
    ],
  }
);
