import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { user } from "../../db/user";

const schemaType = t.object({
  ...user.pickFields(["id"], { optional: true }),
  ...user.omitFields(["id"]),
});

export const hook = createTailorDBHook(user);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, user),
  {
    indexes: [
      {"name":"user_email_unique_idx","columns":["email"],"unique":true},
    ],
  }
);
