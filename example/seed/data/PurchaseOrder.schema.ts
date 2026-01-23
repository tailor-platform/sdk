import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { purchaseOrder } from "../../tailordb/purchaseOrder";

const schemaType = t.object({
  ...purchaseOrder.pickFields(["id","createdAt"], { optional: true }),
  ...purchaseOrder.omitFields(["id","createdAt"]),
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
