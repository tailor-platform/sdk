import { createExecutor, recordTrigger } from "@tailor-platform/sdk";
import { organization } from "../tailordb/organization";

export default createExecutor({
  name: "on-org-changed",
  description: "Handle organization created/updated events",
  trigger: recordTrigger({ type: organization, events: ["created", "updated"] }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.event === "created") {
        console.log("Org created:", args.newRecord.name);
      } else {
        console.log("Org updated:", args.newRecord.name);
      }
    },
  },
});
