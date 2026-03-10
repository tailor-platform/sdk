import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createExecutor({
  name: "on-user-created",
  description: "Triggered when a new user is created",
  trigger: recordCreatedTrigger({ type: user }),
  operation: {
    kind: "function",
    body: async (_args) => {
      // no-op for test fixture
    },
  },
});
