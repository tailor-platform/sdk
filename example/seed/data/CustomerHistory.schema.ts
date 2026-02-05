import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "@tailor-platform/sdk/change-history-plugin";
import { customer } from "../../tailordb/customer";

const CustomerHistory = getGeneratedType(customer, "history");

const schemaType = t.object({
  ...CustomerHistory.pickFields(["id","createdAt"], { optional: true }),
  ...CustomerHistory.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(CustomerHistory);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    indexes: [
      {"name":"idx_customer_history_record","columns":["recordId","action"]},
    ],
  }
);
