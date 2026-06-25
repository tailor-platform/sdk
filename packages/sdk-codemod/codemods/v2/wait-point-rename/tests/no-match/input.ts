import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const job = createWorkflowJob({ name: "job", body: () => ({ ok: true }) });
export default createWorkflow({ name: "wf", mainJob: job });
