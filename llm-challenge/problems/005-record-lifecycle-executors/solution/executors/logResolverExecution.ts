import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import getProduct from "../resolvers/getProduct/resolver";

export default createExecutor({
  name: "log-resolver-execution",
  description: "Logs when getProduct resolver is executed",
  trigger: resolverExecutedTrigger({
    resolver: getProduct,
  }),
  operation: {
    kind: "function",
    body: async (args) => {
      if (args.success) {
        console.log(`Resolver succeeded with result: ${JSON.stringify(args.result)}`);
      } else {
        console.log(`Resolver failed with error: ${args.error}`);
      }
    },
  },
});
