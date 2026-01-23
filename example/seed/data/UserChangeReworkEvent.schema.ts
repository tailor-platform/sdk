import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { UserChangeReworkEvent } from "../../tailordb/user";

const schemaType = t.object({
  ...UserChangeReworkEvent.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeReworkEvent.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeReworkEvent);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
