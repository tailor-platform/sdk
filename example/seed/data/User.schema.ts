import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { User } from "../../tailordb/user";

const schemaType = t.object({
  ...User.pickFields(["id","createdAt"], { optional: true }),
  ...User.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(User);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    indexes: [
      {"name":"user_email_unique_idx","columns":["email"],"unique":true},
    ],
  }
);
