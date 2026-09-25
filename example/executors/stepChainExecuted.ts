import { createExecutor, resolverExecutedTrigger } from "@tailor-platform/sdk";
import stepChain from "../resolvers/stepChain";

export default createExecutor({
  name: "step-chain-executed",
  description: "Triggered when a step chain is executed",
  disabled: true,
  trigger: resolverExecutedTrigger({
    resolver: stepChain,
    condition: ({ result }) => {
      if (!result) return false;
      return result.result.summary.length > 0;
    },
  }),
  operation: {
    kind: "webhook",
    url: ({ result }) => `https://example.com/webhook/${result!.result.summary.length}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "my-vault", key: "my-secret" },
    },
    requestBody: ({ result }) => ({
      orderId: result!.result.summary[0],
      customerID: result!.result.summary[1],
      totalPrice: result!.result.summary[2],
    }),
  },
});
