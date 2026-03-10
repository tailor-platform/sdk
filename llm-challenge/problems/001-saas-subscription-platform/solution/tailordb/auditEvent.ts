import { db } from "@tailor-platform/sdk";
import { organization } from "./organization";

export const auditEvent = db
  .type("AuditEvent", {
    organizationId: db.uuid().relation({ type: "n-1", toward: { type: organization } }),
    action: db.enum(["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT"]),
    actor: db.string(),
    target: db.string({ optional: true }),
    metadata: db.object({
      ip: db.string(),
      userAgent: db.string({ optional: true }),
      requestId: db.uuid(),
    }),
    occurredAt: db.datetime({ optional: true }),
    tags: db.string({ optional: true, array: true }),
    createdAt: db.datetime({ optional: true }).description("Record creation timestamp"),
  })
  .hooks({
    occurredAt: { create: () => new Date() },
    createdAt: { create: () => new Date() },
  });
