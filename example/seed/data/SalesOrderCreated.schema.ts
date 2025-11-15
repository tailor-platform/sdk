import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { salesOrderCreated } from "../../tailordb/salesOrder";

const schemaType = t.object({
  ...salesOrderCreated.pickFields(["id"], { optional: true }),
  ...salesOrderCreated.omitFields(["id"]),
});

const hook = createTailorDBHook(salesOrderCreated);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
