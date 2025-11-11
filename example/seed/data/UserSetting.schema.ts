import { t } from "@tailor-platform/tailor-sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/tailor-sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { userSetting } from "../../tailordb/userSetting";

const schemaType = t.object({
  ...userSetting.pickFields(["id","createdAt"], { optional: true }),
  ...userSetting.omitFields(["id","createdAt"]),
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