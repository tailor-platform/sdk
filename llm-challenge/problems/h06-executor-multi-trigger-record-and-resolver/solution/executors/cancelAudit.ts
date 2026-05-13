import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import cancelOrder from "../resolvers/cancelOrder";
import { recordAudit } from "./_audit";

export default createExecutor({
  name: "cancel-audit",
  description: "Logs an audit entry whenever the cancelOrder resolver executes",
  trigger: resolverExecutedTrigger({
    resolver: cancelOrder,
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      recordAudit({ source: "resolver", reference: args.resolverName });
    },
  },
});
