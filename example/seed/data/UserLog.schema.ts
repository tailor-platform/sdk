import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { userLog } from "../../tailordb/userLog";

const schemaType = t.object({
  ...userLog.pickFields(["id"], { optional: true }),
  ...userLog.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(userLog, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(userLog)),
  {
    foreignKeys: [
      {"column":"userID","references":{"table":"User","column":"id"}},
    ],
  }
);
