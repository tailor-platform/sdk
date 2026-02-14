import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const processOrderJob = createWorkflowJob({
  name: "process-order-job",
  body: (input: { orderId: string }) => {
    return { processed: true, orderId: input.orderId };
  },
});

export default createWorkflow({
  name: "process-order-workflow",
  mainJob: processOrderJob,
});
