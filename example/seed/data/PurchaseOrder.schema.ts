import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { purchaseOrder } from "../../tailordb/purchaseOrder";

const schemaType = t.object({
  ...purchaseOrder.pickFields(["id"], { optional: true }),
  ...purchaseOrder.omitFields(["id"]),
});

const hook = createTailorDBHook(purchaseOrder);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"supplierID","references":{"table":"Supplier","column":"id"}},
    ],
  }
);
