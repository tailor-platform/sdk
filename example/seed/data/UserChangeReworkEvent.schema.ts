import { db, t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const UserChangeReworkEvent = db.type("UserChangeReworkEvent", {
  request: db.uuid().index(),
  iteration: db.int(),
  fromStepNo: db.int(),
  requestedBy: db.uuid().index(),
  requestedAt: db.datetime(),
  reason: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

const schemaType = t.object({
  ...UserChangeReworkEvent.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeReworkEvent.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeReworkEvent);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
