import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

const planHierarchy: Record<string, number> = {
  FREE: 0,
  STARTER: 1,
  BUSINESS: 2,
  ENTERPRISE: 3,
};

const planRates: Record<string, number> = {
  FREE: 0,
  STARTER: 29.99,
  BUSINESS: 99.99,
  ENTERPRISE: 299.99,
};

export default createResolver({
  name: "upgradeSubscription",
  description: "Upgrade a subscription to a higher plan",
  operation: "mutation",
  input: {
    subscriptionId: t.uuid(),
    targetPlan: t.enum(["FREE", "STARTER", "BUSINESS", "ENTERPRISE"]),
    effectiveDate: t.date(),
  },
  output: t.object({
    success: t.bool(),
    previousPlan: t.string({ optional: true }),
    newPlan: t.string({ optional: true }),
    proratedAmount: t.float({ optional: true }),
    effectiveDate: t.date({ optional: true }),
    error: t.string({ optional: true }),
  }),
  body: async ({ input }) => {
    const db = getDB("tailordb");
    const sub = await db
      .selectFrom("Subscription")
      .where("id", "=", input.subscriptionId)
      .selectAll()
      .executeTakeFirst();

    if (!sub) {
      return { success: false, error: "Subscription not found" };
    }

    if (sub.status !== "ACTIVE") {
      return { success: false, error: "Subscription is not active" };
    }

    const currentLevel = planHierarchy[sub.plan] ?? -1;
    const targetLevel = planHierarchy[input.targetPlan] ?? -1;

    if (targetLevel <= currentLevel) {
      return { success: false, error: "Can only upgrade to a higher plan" };
    }

    const newRate = planRates[input.targetPlan] ?? 0;

    return {
      success: true,
      previousPlan: sub.plan,
      newPlan: input.targetPlan,
      proratedAmount: newRate,
      effectiveDate: input.effectiveDate,
    };
  },
});
