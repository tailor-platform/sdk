import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { customerNote } from "../../tailordb/customerNote";

const schemaType = t.object({
  ...customerNote.pickFields(["id","createdAt"], { optional: true }),
  ...customerNote.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(customerNote);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"customerID","references":{"table":"Customer","column":"id"}},
    ],
    indexes: [
      {"name":"idx_customerID_createdAt","columns":["customerID","createdAt"],"unique":false},
    ],
  }
);
