import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const cleanupOldRecords = createWorkflowJob({
  name: "cleanup-old-records",
  body: (input: { daysOld: number }) => {
    return { deletedCount: 0, daysOld: input.daysOld };
  },
});

export default createWorkflow({
  name: "cleanup-workflow",
  mainJob: cleanupOldRecords,
});
