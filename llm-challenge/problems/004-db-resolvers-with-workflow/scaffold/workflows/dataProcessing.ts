import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const processDataJob = createWorkflowJob({
  name: "process-data-job",
  body: (input: { dataId: string; priority: string }) => {
    return { processed: true, dataId: input.dataId };
  },
});

export default createWorkflow({
  name: "data-processing",
  mainJob: processDataJob,
});
