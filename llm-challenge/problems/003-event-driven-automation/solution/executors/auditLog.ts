import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import processAudit from "../resolvers/processAudit/resolver";

export default createExecutor({
  name: "audit-log",
  description: "Logs audit resolver execution results",
  trigger: resolverExecutedTrigger({
    resolver: processAudit,
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.success) {
        console.log("Audit succeeded:", JSON.stringify(args.result));
      } else {
        console.error("Audit failed:", args.error);
      }
    },
  },
});
