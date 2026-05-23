import { createExecutor, recordCreatedTrigger } from "@tailor-platform/sdk";
import { member } from "../tailordb/member";

export default createExecutor({
  name: "on-member-created",
  description: "Log when a new member is created",
  trigger: recordCreatedTrigger({ type: member }),
  operation: {
    kind: "function",
    body: async (args) => {
      console.log("Member created:", args.newRecord.email);
    },
  },
});
