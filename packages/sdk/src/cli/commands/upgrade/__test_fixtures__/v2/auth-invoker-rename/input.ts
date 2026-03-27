import { createExecutor } from "@tailor-platform/sdk";
import { scheduleTrigger } from "@tailor-platform/sdk/trigger";
import { auth } from "../tailor.config";
import orderProcessingWorkflow from "../workflows/orderProcessing";

export default createExecutor({
  name: "daily-order-sync",
  trigger: scheduleTrigger({ cron: "0 0 * * *" }),
  operation: {
    kind: "workflow",
    workflow: orderProcessingWorkflow,
    args: ({ _env }) => ({
      mode: "sync",
    }),
    authInvoker: auth.invoker("manager-machine-user"),
  },
});
