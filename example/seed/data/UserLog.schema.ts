import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { userLog } from "../../tailordb/userLog";

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
