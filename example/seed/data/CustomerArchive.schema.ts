import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "../../plugins/soft-delete";
import { customer } from "../../tailordb/customer";

const CustomerArchive = getGeneratedType(customer, "archive");

const schemaType = t.object({
  ...CustomerArchive.pickFields(["id","createdAt"], { optional: true }),
  ...CustomerArchive.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(CustomerArchive);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    indexes: [
      {"name":"customerarchive_deleted_at_idx","columns":["deletedAt","originalId"]},
    ],
  }
);
