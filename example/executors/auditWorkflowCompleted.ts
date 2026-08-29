import { createExecutor, workflowExecutionCompletedTrigger } from "@tailor-platform/sdk";
import auditWorkflow from "../workflows/audit";

export default createExecutor({
  name: "audit-workflow-completed",
  description: "Triggered when the audit workflow finishes",
  disabled: true,
  trigger: workflowExecutionCompletedTrigger({ workflow: auditWorkflow }),
  operation: {
    kind: "webhook",
    url: () => "https://example.com/webhook/audit-workflow",
    headers: { "Content-Type": "application/json" },
    requestBody: () => ({ notified: true }),
  },
});
