import { createWorkflow, createWorkflowJob, defineWaitPoint, defineWaitPoints } from "@tailor-platform/sdk";

export const { approval } = defineWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

export const singlePoint = defineWaitPoint<{ id: string }, boolean>("my-step");

export const processJob = createWorkflowJob({
  name: "process",
  body: async (input: { orderId: string }) => {
    const result = await approval.wait({ message: `approve ${input.orderId}` });
    return { approved: result.approved };
  },
});

export default createWorkflow({ name: "my-workflow", mainJob: processJob });
