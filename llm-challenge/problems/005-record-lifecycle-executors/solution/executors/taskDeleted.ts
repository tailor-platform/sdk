import { createExecutor, recordDeletedTrigger } from "@tailor-platform/sdk";
import { task } from "../tailordb/task";

export default createExecutor({
  name: "task-deleted",
  description: "Triggered when a task is deleted",
  trigger: recordDeletedTrigger({
    type: task,
  }),
  operation: {
    kind: "function",
    body: async ({ oldRecord }) => {
      console.log(`Task deleted: ${oldRecord.title}`);
    },
  },
});
