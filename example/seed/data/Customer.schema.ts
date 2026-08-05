import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { customer } from "../../tailordb/customer";

const schemaType = t.object({
  ...customer.pickFields(["id"], { optional: true }),
  ...customer.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(customer, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(customer)),
);
