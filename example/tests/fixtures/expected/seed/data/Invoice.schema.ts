import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { invoice } from "../../../../../tailordb/invoice";

const schemaType = t.object({
  ...invoice.pickFields(["id","createdAt"], { optional: true }),
  ...invoice.omitFields(["id","createdAt","invoiceNumber","sequentialId"]),
});

const hook = createTailorDBHook(invoice);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, invoice.metadata?.validate),
  {
    foreignKeys: [
      {"column":"salesOrderID","references":{"table":"SalesOrder","column":"id"}},
    ],
    indexes: [
      {"name":"invoice_salesOrderID_unique_idx","columns":["salesOrderID"],"unique":true},
    ],
  }
);
