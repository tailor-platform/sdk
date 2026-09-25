import { createWorkflow, createWorkflowJob, createWaitPoint, createWaitPoints } from "@tailor-platform/sdk";

export const { approval } = createWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

export const singlePoint = createWaitPoint<{ id: string }, boolean>("my-step");

export const processJob = createWorkflowJob({
  name: "process",
  body: async (input: { orderId: string }) => {
    const result = await approval.wait({ message: `approve ${input.orderId}` });
    return { approved: result.approved };
  },
});

export default createWorkflow({ name: "my-workflow", mainJob: processJob });
