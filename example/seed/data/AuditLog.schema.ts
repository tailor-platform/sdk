import { t } from "@tailor-platform/sdk";
import { createTailorDBHook, createStandardSchema } from "@tailor-platform/sdk/test";
import { defineSchema } from "@toiroakr/lines-db";
import { getGeneratedType } from "@tailor-platform/sdk/audit-log-plugin";

const AuditLog = getGeneratedType("audit-log");

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
