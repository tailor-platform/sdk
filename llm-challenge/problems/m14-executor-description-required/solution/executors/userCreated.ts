import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createExecutor({
  name: "user-created",
  description: "Triggered when a new User record is created",
  trigger: recordCreatedTrigger({ type: user }),
  operation: {
    kind: "function",
    body: async (args) => {
      console.log("user created:", args.newRecord.email);
    },
  },
});
