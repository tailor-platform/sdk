import { t } from "@tailor-platform/sdk";
import { defineSchema, createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/seed";
import { event } from "../../../../../analyticsdb/event";

const schemaType = t.object({
  ...event.pickFields(["id","createdAt"], { optional: true }),
  ...event.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(event);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
