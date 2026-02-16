import { join } from "node:path";
import { t } from "@tailor-platform/sdk";
import { getGeneratedType } from "@tailor-platform/sdk/plugin";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { purchaseOrder } from "../../tailordb/purchaseOrder";

const configPath = join(import.meta.dirname, "../../tailor.config.ts");
const PurchaseOrderChangeRequest = await getGeneratedType(configPath, "@tailor-platform/changeset", purchaseOrder, "request");

const schemaType = t.object({
  ...PurchaseOrderChangeRequest.pickFields(["id","currentStepNo","createdAt"], { optional: true }),
  ...PurchaseOrderChangeRequest.omitFields(["id","currentStepNo","createdAt"]),
});

const hook = createTailorDBHook(PurchaseOrderChangeRequest);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"draft","references":{"table":"PurchaseOrder","column":"id"}},
    ],
    indexes: [
      {"name":"request_record_status_idx","columns":["recordId","status"],"unique":false},
    ],
  }
);
