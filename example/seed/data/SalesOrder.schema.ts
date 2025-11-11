import { t } from "@tailor-platform/tailor-sdk";
import { defineSchema } from "@toiroakr/lines-db";
import { salesOrder } from "../../tailordb/salesOrder";

const schemaType = t.object({
  ...salesOrder.pickFields(["id","createdAt"], { optional: true }),
  ...salesOrder.omitFields(["id","createdAt"]),
});

const contextUser = {
  id: "",
  type: "",
  workspaceId: process.env.TAILOR_WORKSPACE_ID ?? "",
  attributes: null,
  attributeList: [],
} as const satisfies Parameters<typeof schemaType.parse>[0]["user"];

const hook = (data: unknown) => {
  return Object.entries(salesOrder.fields).reduce(
    (hooked, [key, value]) => {
      if (key === "id") {
        hooked[key] = crypto.randomUUID();
      } else if (value.type === "nested") {
        hooked[key] = hook((data as Record<string, unknown>)[key]);
      } else if (value.metadata.hooks?.create) {
        hooked[key] = value.metadata.hooks.create({
              value: (data as Record<string, unknown>)[key],
              data: data,
              user: contextUser,
            });
      } else if (data && typeof data === "object") {
        hooked[key] = (data as Record<string, unknown>)[key];
      }
      return hooked;
    },
    {} as Record<string, unknown>,
  ) as t.infer<typeof schemaType>;
};

export const schema = defineSchema(
  {
    "~standard": {
      version: 1,
      vendor: "@tailor-platform/tailor-sdk",
      validate: (value) => {
        const hooked = hook(value);
        const result = schemaType.parse({
          value: hooked,
          data: hooked,
          user: contextUser,
        });
        if (result.issues) {
          return result;
        }
        return { value: hooked };
      },
    },
  },
  {
    foreignKeys: [
      {"column":"customerID","references":{"table":"Customer","column":"id"}},
    ],
    indexes: [
      {"name":"idx_status_createdAt","columns":["status","createdAt"],"unique":false},
      {"name":"idx_customerID_status","columns":["customerID","status"],"unique":false},
    ],
  }
);