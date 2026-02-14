import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "completeTask",
  operation: "mutation",
  input: {
    taskId: t.string(),
    completedBy: t.string(),
  },
  body: ({ input }) => {
    return {
      taskId: input.taskId,
      status: "completed",
      completedBy: input.completedBy,
    };
  },
  output: t.object({
    taskId: t.string(),
    status: t.string(),
    completedBy: t.string(),
  }),
});
