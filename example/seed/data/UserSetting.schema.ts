import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { userSetting } from "../../tailordb/userSetting";

const schemaType = t.object({
  ...userSetting.pickFields(["id"], { optional: true }),
  ...userSetting.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(userSetting, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(userSetting)),
  {
    foreignKeys: [
      {"column":"userID","references":{"table":"User","column":"id"}},
    ],
    indexes: [
      {"name":"usersetting_userID_unique_idx","columns":["userID"],"unique":true},
    ],
  }
);
