import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { userLog } from "../../tailordb/userLog";

const schemaType = t.object({
  ...userLog.pickFields(["id"], { optional: true }),
  ...userLog.omitFields(["id"]),
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
