import { t } from "@tailor-platform/sdk";
import { createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const schemaType = t.object({
  name: t.string(),
  password: t.string(),
});

// Simple identity hook for _User (no TailorDB backing type)
const hook = <T>(data: unknown) => data as T;

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    primaryKey: "name",
    indexes: [
      { name: "_user_name_unique_idx", columns: ["name"], unique: true },
    ],
    foreignKeys: [
      {
        column: "name",
        references: {
          table: "User",
          column: "email",
        },
      },
    ],
  }
);
