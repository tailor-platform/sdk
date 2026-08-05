import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { invoice } from "../../tailordb/invoice";

const schemaType = t.object({
  ...invoice.pickFields(["id"], { optional: true }),
  ...invoice.omitFields(["id","invoiceNumber","sequentialId"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(invoice, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(invoice)),
  {
    foreignKeys: [
      {"column":"salesOrderID","references":{"table":"SalesOrder","column":"id"}},
    ],
    indexes: [
      {"name":"invoice_salesOrderID_unique_idx","columns":["salesOrderID"],"unique":true},
    ],
  }
);
