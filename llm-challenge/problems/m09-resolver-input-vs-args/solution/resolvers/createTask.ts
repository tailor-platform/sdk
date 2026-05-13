import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "createTask",
  operation: "mutation",
  input: {
    title: t.string(),
  },
  body: ({ input }) => ({ id: "task-1", title: input.title }),
  output: t.object({
    id: t.string(),
    title: t.string(),
  }),
});
