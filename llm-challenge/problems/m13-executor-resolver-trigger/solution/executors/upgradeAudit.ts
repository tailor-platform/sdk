import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import upgrade from "../resolvers/upgrade";

export default createExecutor({
  name: "upgrade-audit",
  description: "Records a successful upgrade resolver execution",
  trigger: resolverExecutedTrigger({
    resolver: upgrade,
    condition: (args) => args.success,
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.success) {
        console.log("upgrade resolver succeeded for", args.result.customerId);
      }
    },
  },
});
