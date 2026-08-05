import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { order } from "../../db/order";

const schemaType = t.object({
  ...order.pickFields(["id"], { optional: true }),
  ...order.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(order, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(order)),
  {
    foreignKeys: [
      {"column":"productId","references":{"table":"Product","column":"id"}},
      {"column":"userId","references":{"table":"User","column":"id"}},
    ],
  }
);
