import { createType } from "@tailor-platform/sdk";
import { organization } from "./organization";

export const auditEvent = createType("AuditEvent", {
  organizationId: {
    kind: "uuid",
    relation: { type: "n-1", toward: { type: organization } },
  },
  action: { kind: "enum", values: ["CREATE", "UPDATE", "DELETE", "LOGIN", "EXPORT"] },
  actor: { kind: "string" },
  target: { kind: "string", optional: true },
  metadata: {
    kind: "object",
    fields: {
      ip: { kind: "string" },
      userAgent: { kind: "string", optional: true },
      requestId: { kind: "uuid" },
    },
  },
  occurredAt: { kind: "datetime", hooks: { create: () => new Date() } },
  tags: { kind: "string", array: true, optional: true },
  createdAt: {
    kind: "datetime",
    hooks: { create: () => new Date() },
    description: "Record creation timestamp",
  },
});
export type auditEvent = typeof auditEvent;
