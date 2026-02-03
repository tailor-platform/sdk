import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const processOrderJob = createWorkflowJob({
  name: "scriptref-process-job",
  scriptRef: "processOrder",
});

export default createWorkflow({
  name: "scriptref-workflow",
  mainJob: processOrderJob,
});
