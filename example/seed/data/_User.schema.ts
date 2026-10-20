import { t } from "@tailor-platform/sdk";
import { defineSchema, fillIdpUserPassword } from "@tailor-platform/sdk/seed";
import { createStandardSchema } from "@tailor-platform/sdk/test";

const schemaType = t.object({
  name: t.string(),
  password: t.string(),
});

export const hook = <T>(data: unknown) => fillIdpUserPassword(data) as T;

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
