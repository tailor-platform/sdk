import { createExecutor, recordUpdatedTrigger } from "@tailor-platform/sdk";
import { subscription } from "../tailordb/subscription";

export default createExecutor({
  name: "subscription-plan-changed",
  description: "Syncs plan changes when a subscription plan is updated",
  trigger: recordUpdatedTrigger({
    type: subscription,
    condition: ({ newRecord, oldRecord }) => oldRecord.plan !== newRecord.plan,
  }),
  operation: {
    kind: "graphql",
    query: `mutation syncPlanChange($input: PlanChangeInput!) { syncPlanChange(input: $input) { id } }`,
    variables: ({ newRecord }) => ({
      input: {
        subscriptionId: newRecord.id,
        newPlan: newRecord.plan,
      },
    }),
  },
});
