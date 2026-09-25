import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { auditTrail } from "../tailordb/auditTrail";

export default createExecutor({
  name: "audit-trail-created",
  description: "Triggered when an audit trail entry is created",
  disabled: true,
  trigger: recordCreatedTrigger({ type: auditTrail }),
  operation: {
    kind: "webhook",
    url: ({ newRecord }) => `https://example.com/webhook/audit/${newRecord.id}`,
    headers: { "Content-Type": "application/json" },
    requestBody: ({ newRecord }) => ({ action: newRecord.action }),
  },
});
