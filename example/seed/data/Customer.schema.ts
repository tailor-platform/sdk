import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { customer } from "../../tailordb/customer";

const schemaType = t.object({
  ...customer.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...customer.omitFields(["id","createdAt","updatedAt"]),
});

export const hook = createTailorDBHook(customer);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, customer, { fields: ["id","name","email","phone","country","postalCode","address","city","fullAddress","state","createdAt","updatedAt"] }),
);
