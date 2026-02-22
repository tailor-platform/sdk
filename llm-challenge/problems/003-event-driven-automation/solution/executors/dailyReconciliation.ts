import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import reconciliationWorkflow from "../workflows/reconciliation";

export default createExecutor({
  name: "daily-reconciliation",
  description: "Runs daily reconciliation workflow at 2 AM UTC",
  trigger: scheduleTrigger({ cron: "0 2 * * *", timezone: "UTC" }),
  operation: {
    kind: "workflow",
    workflow: reconciliationWorkflow,
    args: () => ({ date: new Date().toISOString() }),
    authInvoker: { namespace: "my-auth", machineUserName: "reconciliation-user" },
  },
});
