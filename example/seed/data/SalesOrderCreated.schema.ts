import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { salesOrderCreated } from "../../tailordb/salesOrder";

const schemaType = t.object({
  ...salesOrderCreated.pickFields(["id"], { optional: true }),
  ...salesOrderCreated.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(salesOrderCreated, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(salesOrderCreated)),
);
