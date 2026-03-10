import { t } from "@tailor-platform/sdk";
import { defineSchema, createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/seed";
import { customer } from "../../../../../tailordb/customer";

const schemaType = t.object({
  ...customer.pickFields(["id","fullAddress","createdAt"], { optional: true }),
  ...customer.omitFields(["id","fullAddress","createdAt"]),
});

const hook = createTailorDBHook(customer);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
