import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { salesOrder } from "../../tailordb/salesOrder";

const schemaType = t.object({
  ...salesOrder.pickFields(["id"], { optional: true }),
  ...salesOrder.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(salesOrder, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(salesOrder)),
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
