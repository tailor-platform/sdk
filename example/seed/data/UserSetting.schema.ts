import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { userSetting } from "../../tailordb/userSetting";

const schemaType = t.object({
  ...userSetting.pickFields(["id","createdAt"], { optional: true }),
  ...userSetting.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(userSetting);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, userSetting.metadata?.validate),
  {
    foreignKeys: [
      {"column":"userID","references":{"table":"User","column":"id"}},
    ],
    indexes: [
      {"name":"usersetting_userID_unique_idx","columns":["userID"],"unique":true},
    ],
  }
);
