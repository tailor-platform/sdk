import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";
import billingCycleWorkflow from "../workflows/billingCycle";

export default createExecutor({
  name: "monthly-billing-cycle",
  description: "Triggers monthly billing cycle on the 1st of each month",
  trigger: scheduleTrigger({ cron: "0 0 1 * *", timezone: "UTC" }),
  operation: {
    kind: "workflow",
    workflow: billingCycleWorkflow,
    args: () => ({
      organizationId: "scheduled",
      plan: "BUSINESS",
      monthlyRate: 0,
      billingPeriod: {
        start: new Date().toISOString().slice(0, 10),
        end: new Date().toISOString().slice(0, 10),
      },
    }),
    authInvoker: { namespace: "saas-auth", machineUserName: "BILLING_WORKER" },
  },
});
