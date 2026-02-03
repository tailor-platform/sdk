import { db, t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const UserChangeStep = db.type(["UserChangeStep", "UserChangeSteps"], {
  request: db.uuid().index(),
  iteration: db.int(),
  stepNo: db.int(),
  stepName: db.string(),
  quorumType: db.enum(["ALL", "ANY"]),
  minApprovals: db.int({ optional: true }),
  status: db.enum(["PENDING", "APPROVED", "REWORK", "REJECTED", "SKIPPED"]).index(),
  startedAt: db.datetime(),
  finishedAt: db.datetime({ optional: true }),
  ...db.fields.timestamps(),
});

const schemaType = t.object({
  ...UserChangeStep.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeStep.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeStep);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
