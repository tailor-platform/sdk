import { createWaitPoints, createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

const state = globalThis as typeof globalThis & {
  __tailorReloadWorkflowCount?: number;
};
state.__tailorReloadWorkflowCount = (state.__tailorReloadWorkflowCount ?? 0) + 1;

const waitPoints = createWaitPoints((define) => ({
  "reload-approval": define<{ requestId: string }, { approved: boolean }>(),
}));

export const reloadApprovalJob = createWorkflowJob({
  name: "reload-approval-job",
  body: async (input: { orderId: string }) => {
    const result = await waitPoints["reload-approval"].wait({ requestId: input.orderId });
    return { approved: result.approved };
  },
});

export default createWorkflow({
  name: "reload-approval-workflow",
  mainJob: reloadApprovalJob,
});
