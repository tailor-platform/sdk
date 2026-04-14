import { createWorkflow, createWorkflowJob, waitPoint } from "@tailor-platform/sdk";

export const processWithApproval = createWorkflowJob({
  name: "process-with-approval",
  waitPoints: {
    approval: waitPoint<{ message: string; requestId: string }, { approved: boolean }>(),
  },
  body: async (input: { orderId: string }, { wait }) => {
    const result = await wait("approval", {
      message: `Please approve order ${input.orderId}`,
      requestId: input.orderId,
    });

    if (!result.approved) {
      return { orderId: input.orderId, status: "rejected" as const };
    }

    return { orderId: input.orderId, status: "approved" as const };
  },
});

export default createWorkflow({
  name: "approval-workflow",
  mainJob: processWithApproval,
});
