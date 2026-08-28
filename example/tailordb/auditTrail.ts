import { db } from "@tailor-platform/sdk";
import { defaultGqlPermission, defaultPermission } from "./permissions";

export const auditTrail = db
  .table("AuditTrail", {
    action: db.string(),
    detail: db.string(),
    ...db.fields.timestamps(),
  })
  .permission(defaultPermission)
  .gqlPermission(defaultGqlPermission);
