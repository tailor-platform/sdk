import { createWorkflow, createWorkflowJob, defineWaitPoints } from "@tailor-platform/sdk";

export const { approval } = defineWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

export const processApproval = createWorkflowJob({
  name: "process-approval",
  body: async (input: { requestId: string }) => {
    const result = await approval.wait({
      message: `Please approve request ${input.requestId}`,
    });
    return {
      requestId: input.requestId,
      status: (result.approved ? "approved" : "rejected") as "approved" | "rejected",
    };
  },
});

export default createWorkflow({
  name: "approval-workflow",
  mainJob: processApproval,
});
