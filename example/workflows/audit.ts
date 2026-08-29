import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const recordAudit = createWorkflowJob({
  name: "record-audit",
  body: async (input: { action: string }) => {
    return { action: input.action, recorded: true };
  },
});

export default createWorkflow({
  name: "audit-workflow",
  mainJob: recordAudit,
});
