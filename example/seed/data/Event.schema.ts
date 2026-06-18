import { t } from "@tailor-platform/sdk";
import { defineSchema } from "@tailor-platform/sdk/seed";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { event } from "../../analyticsdb/event";

const schemaType = t.object({
  ...event.pickFields(["id","createdAt","updatedAt"], { optional: true }),
  ...event.omitFields(["id","createdAt","updatedAt"]),
});

const hook = createTailorDBHook(event);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
