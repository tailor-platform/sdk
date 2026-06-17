import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { salesOrder } from "../../tailordb/salesOrder";

const schemaType = t.object({
  ...salesOrder.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...salesOrder.omitFields(["id","createdAt","updatedAt"]),
});

const hook = createTailorDBHook(salesOrder);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
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
