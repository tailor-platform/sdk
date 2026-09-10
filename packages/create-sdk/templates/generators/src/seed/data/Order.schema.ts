import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { order } from "../../db/order";

const schemaType = t.object({
  ...order.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...order.omitFields(["id","createdAt","updatedAt"]),
});

export const hook = createTailorDBHook(order);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, order, { fields: ["id","productId","userId","quantity","totalPrice","status","createdAt","updatedAt"] }),
  {
    foreignKeys: [
      {"column":"productId","references":{"table":"Product","column":"id"}},
      {"column":"userId","references":{"table":"User","column":"id"}},
    ],
  }
);
