import { join } from "node:path";
import { t } from "@tailor-platform/sdk";
import { getGeneratedType } from "@tailor-platform/sdk/plugin";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { purchaseOrder } from "../../tailordb/purchaseOrder";

const configPath = join(import.meta.dirname, "../../tailor.config.ts");
const PurchaseOrderChangeReworkEvent = await getGeneratedType(configPath, "@tailor-platform/changeset", purchaseOrder, "rework");

const schemaType = t.object({
  ...PurchaseOrderChangeReworkEvent.pickFields(["id","createdAt"], { optional: true }),
  ...PurchaseOrderChangeReworkEvent.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(PurchaseOrderChangeReworkEvent);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"request","references":{"table":"PurchaseOrderChangeRequest","column":"id"}},
    ],
  }
);
