import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk-plugin-seed/schema";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { table } from "../../db/ledger/table";

const schemaType = t.object({
  ...table.pickFields(["id"], { optional: true }),
  ...table.omitFields(["id"]),
});

export const hook = createTailorDBHook(table);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook, table),
);
