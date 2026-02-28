import { db } from "@tailor-platform/sdk";

export const auditLog = db.type("AuditLog", {
  action: db.string(),
  performedBy: db.string(),
  details: db.string({ optional: true }),
  ...db.fields.timestamps(),
});

export type auditLog = typeof auditLog;
