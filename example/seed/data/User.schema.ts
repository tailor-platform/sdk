import { t } from "@tailor-platform/tailor-sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/tailor-sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { user } from "../../tailordb/user";

const schemaType = t.object({
  ...user.pickFields(["id","createdAt"], { optional: true }),
  ...user.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(user);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    indexes: [
      {"name":"user_email_unique_idx","columns":["email"],"unique":true},
      {"name":"idx_name_department","columns":["name","department"],"unique":false},
      {"name":"user_status_created_idx","columns":["status","createdAt"],"unique":false},
    ],
  }
);