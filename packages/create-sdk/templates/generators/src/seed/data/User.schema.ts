import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { user } from "../../db/user";

const schemaType = t.object({
  ...user.pickFields(["id"], { optional: true }),
  ...user.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(user, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(user)),
  {
    indexes: [
      {"name":"user_email_unique_idx","columns":["email"],"unique":true},
    ],
  }
);
