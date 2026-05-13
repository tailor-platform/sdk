import { createExecutor, recordTrigger } from "@tailor-platform/sdk";
import { user } from "../tailordb/user";

export default createExecutor({
  name: "user-touched",
  description: "Triggered when a user record is created or updated",
  trigger: recordTrigger({
    type: user,
    events: ["created", "updated"],
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.event === "created") {
        console.log("user created:", args.newRecord.email);
      } else {
        console.log("user updated:", args.newRecord.email);
      }
    },
  },
});
