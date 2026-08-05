import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { event } from "../../analyticsdb/event";

const schemaType = t.object({
  ...event.pickFields(["id"], { optional: true }),
  ...event.omitFields(["id"]),
});

// Values only: a row that is not complete yet still gets its ids and defaults.
export const hook = createTailorDBHook(event, { validate: false });

export const schema = defineSchema(
  createStandardSchema(schemaType, createTailorDBHook(event)),
);
