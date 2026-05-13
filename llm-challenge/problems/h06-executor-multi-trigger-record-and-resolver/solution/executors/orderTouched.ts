import { createExecutor, recordTrigger } from "@tailor-platform/sdk";
import { order } from "../tailordb/order";
import { recordAudit } from "./_audit";

export default createExecutor({
  name: "order-touched",
  description: "Logs an audit entry whenever an Order record is created or updated",
  trigger: recordTrigger({
    type: order,
    events: ["created", "updated"],
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      recordAudit({ source: "order", reference: args.newRecord.id });
    },
  },
});
