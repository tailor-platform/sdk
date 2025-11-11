import { t } from "@tailor-platform/tailor-sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/tailor-sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { customer } from "../../tailordb/customer";

const schemaType = t.object({
  ...customer.pickFields(["id","fullAddress","createdAt"], { optional: true }),
  ...customer.omitFields(["id","fullAddress","createdAt"]),
});

const hook = createTailorDBHook(customer);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);