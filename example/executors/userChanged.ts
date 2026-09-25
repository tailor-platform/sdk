import { createExecutor, recordTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createExecutor({
  name: "user-changed",
  description: "Triggered when a user is created or updated",
  trigger: recordTrigger({
    type: user,
    events: ["created", "updated"],
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.event === "created") {
        console.log("User created:", args.newRecord.name);
      }
      if (args.event === "updated") {
        console.log("User updated:", args.oldRecord.name, "->", args.newRecord.name);
      }
    },
  },
});
