import { t } from "@tailor-platform/sdk";
import { defineSchema, createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/seed";
import { userLog } from "../../../../../tailordb/userLog";

const schemaType = t.object({
  ...userLog.pickFields(["id","createdAt"], { optional: true }),
  ...userLog.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(userLog);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"userID","references":{"table":"User","column":"id"}},
    ],
  }
);
