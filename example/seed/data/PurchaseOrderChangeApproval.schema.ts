import { join } from "node:path";
import { t } from "@tailor-platform/sdk";
import { getGeneratedType } from "@tailor-platform/sdk/plugin";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { purchaseOrder } from "../../tailordb/purchaseOrder";

const configPath = join(import.meta.dirname, "../../tailor.config.ts");
const PurchaseOrderChangeApproval = await getGeneratedType(configPath, "@tailor-platform/changeset", purchaseOrder, "approval");

const schemaType = t.object({
  ...PurchaseOrderChangeApproval.pickFields(["id","createdAt"], { optional: true }),
  ...PurchaseOrderChangeApproval.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(PurchaseOrderChangeApproval);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"request","references":{"table":"PurchaseOrderChangeRequest","column":"id"}},
    ],
  }
);
