import { db, t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";

const AuditLog = db.type(["AuditLog", "AuditLogs"], {
  targetType: db.string().index(),
  targetId: db.uuid().index(),
  action: db.enum(["CREATE", "UPDATE", "DELETE"]).index(),
  performedBy: db.uuid().index(),
  performedAt: db.datetime().index(),
  changes: db.string({ optional: true }),
  previousValues: db.string({ optional: true }),
  newValues: db.string({ optional: true }),
  metadata: db.string({ optional: true }),
  ...db.fields.timestamps(),
}).description("Audit log for tracking changes across the application").indexes({ fields: ["targetType", "targetId"], name: "idx_audit_target" });

const schemaType = t.object({
  ...AuditLog.pickFields(["id","createdAt"], { optional: true }),
  ...AuditLog.omitFields(["id","createdAt"]),
});

const hook = createTailorDBHook(AuditLog);

export const schema = defineSchema(
  createStandardSchema(schemaType, hook),
  {
    indexes: [
      {"name":"idx_audit_target","columns":["targetType","targetId"]},
    ],
  }
);
