import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { purchaseOrder } from "../../tailordb/purchaseOrder";

const schemaType = t.object({
  ...purchaseOrder.pickFields(["id"], { optional: true }),
  ...purchaseOrder.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(purchaseOrder, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(purchaseOrder)),
  {
    foreignKeys: [
      {"column":"supplierID","references":{"table":"Supplier","column":"id"}},
    ],
  }
);
