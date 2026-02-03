import { db, t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const UserChangeApproval = db.type("UserChangeApproval", {
  request: db.uuid().index(),
  iteration: db.int(),
  stepNo: db.int(),
  approver: db.uuid().index(),
  decision: db.enum(["PENDING", "APPROVED", "REWORK", "REJECTED"]).index(),
  decidedAt: db.datetime({ optional: true }),
  comment: db.string({ optional: true }),
  resolvedByRuleType: db.enum(["USER", "GROUP", "ROLE", "ORG_MANAGER"]),
  resolvedByRuleValue: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

const schemaType = t.object({
  ...UserChangeApproval.pickFields(["id","createdAt"], { optional: true }),
  ...UserChangeApproval.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(UserChangeApproval);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
);
