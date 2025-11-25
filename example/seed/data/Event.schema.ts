import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { event } from "../../analyticsdb/event";

const schemaType = t.object({
  ...event.pickFields(["id","createdAt"], { optional: true }),
  ...event.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(event);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
