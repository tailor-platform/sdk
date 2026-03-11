import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { order } from "../../db/order";

const schemaType = t.object({
  ...order.pickFields(["id","createdAt"], { optional: true }),
  ...order.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(order);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    foreignKeys: [
      {"column":"productId","references":{"table":"Product","column":"id"}},
      {"column":"userId","references":{"table":"User","column":"id"}},
    ],
  }
);
