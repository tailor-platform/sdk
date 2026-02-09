import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "../../plugins/soft-delete";
import { customer } from "../../tailordb/customer";

const Deleted_Customer = getGeneratedType(customer, "archive");

const schemaType = t.object({
  ...Deleted_Customer.pickFields(["id","createdAt"], { optional: true }),
  ...Deleted_Customer.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(Deleted_Customer);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    indexes: [
      {"name":"deleted_customer_deleted_at_idx","columns":["deletedAt","originalId"]},
    ],
  }
);
