import { t } from "@tailor-platform/tailor-sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/tailor-sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { invoice } from "../../tailordb/invoice";

const schemaType = t.object({
  ...invoice.pickFields(["id","createdAt"], { optional: true }),
  ...invoice.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(invoice);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"salesOrderID","references":{"table":"SalesOrder","column":"id"}},
    ],
    indexes: [
      {"name":"invoice_salesOrderID_unique_idx","columns":["salesOrderID"],"unique":true},
    ],
  }
);