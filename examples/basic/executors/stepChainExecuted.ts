import {
  createExecutor,
  resolverExecutedTrigger,
} from "@tailor-platform/tailor-sdk";
import stepChain from "../resolvers/stepChain";

export default createExecutor(
  "step-chain-executed",
  "Triggered when a step chain is executed",
  { disabled: true },
)
  .on(
    resolverExecutedTrigger(stepChain, ({ result }) => {
      if (!result) return false;
      return result.result.summary.length > 0;
    }),
  )
  .executeWebhook({
    url: ({ result }) =>
      `https://example.com/webhook/${result!.result.summary.length}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: { vault: "my-vault", key: "my-secret" },
    },
    body: ({ result }) => ({
      orderId: result!.result.summary[0],
      customerID: result!.result.summary[1],
      totalPrice: result!.result.summary[2],
    }),
  });
