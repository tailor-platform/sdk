import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { userSetting } from "../../tailordb/userSetting";

const schemaType = t.object({
  ...userSetting.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...userSetting.omitFields(["id","createdAt","updatedAt"]),
});

const hook = createTailorDBHook(userSetting);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"userID","references":{"table":"User","column":"id"}},
    ],
    indexes: [
      {"name":"usersetting_userID_unique_idx","columns":["userID"],"unique":true},
    ],
  }
);
