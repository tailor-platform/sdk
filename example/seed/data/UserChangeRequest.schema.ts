import { db, t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const UserChangeRequest = db.type("UserChangeRequest", {
  recordId: db.uuid().index(),
  draft: db.uuid().index(),
  status: db.enum(["RUNNING", "REWORK", "APPROVED", "REJECTED", "CANCELED"]).index(),
  reworkIteration: db.int(),
  currentStepNo: db.int(),
  templateKey: db.string(),
  templateVersion: db.int(),
  requestedBy: db.uuid().index(),
  requestedAt: db.datetime(),
  finalizedAt: db.datetime({ optional: true }),
  effectiveFrom: db.datetime(),
  activationStatus: db.enum(["PENDING", "ACTIVATED"]).index(),
  activatedAt: db.datetime({ optional: true }),
  ...db.fields.timestamps(),
});

const schemaType = t.object({
  ...UserChangeRequest.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeRequest.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeRequest);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
