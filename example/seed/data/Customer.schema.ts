import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { customer } from "../../tailordb/customer";

const schemaType = t.object({
  ...customer.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...customer.omitFields(["id","createdAt","updatedAt"]),
});

const hook = createTailorDBHook(customer);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
