import { createWorkflow, createWorkflowJob, defineWaitPoints } from "@tailor-platform/sdk";

export const { approval } = defineWaitPoints((define) => ({
  /** Approval for order processing */
  approval: define<{ message: string; requestId: string }, { approved: boolean }>(),
}));

export const processWithApproval = createWorkflowJob({
  name: "process-with-approval",
  body: async (input: { orderId: string }) => {
    const result = await approval.wait({
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
