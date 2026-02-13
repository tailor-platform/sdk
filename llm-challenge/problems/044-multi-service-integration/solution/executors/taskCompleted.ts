import { createExecutor, recordUpdatedTrigger } from "@tailor-platform/sdk";
import { task } from "../tailordb/task";

export default createExecutor({
  name: "task-completed-handler",
  description: "Handles task completion by logging the event",
  trigger: recordUpdatedTrigger({
    type: task,
  }),
  operation: {
    kind: "function",
    body: async ({ newRecord, oldRecord }) => {
      if (newRecord.status === "completed" && oldRecord.status !== "completed") {
        console.log(`Task ${newRecord.id} completed`);
      }
    },
  },
});
