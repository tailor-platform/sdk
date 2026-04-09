import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

type BillingPeriod = { start: string; end: string };

type UsageItem = {
  metric: string;
  totalQuantity: number;
};

type CollectUsageInput = {
  organizationId: string;
  billingPeriod: BillingPeriod;
};

type CalculateChargesInput = {
  usageItems: UsageItem[];
  plan: string;
  monthlyRate: number;
};

type ProcessBillingInput = {
  organizationId: string;
  plan: string;
  monthlyRate: number;
  billingPeriod: BillingPeriod;
};

const overageThresholds: Record<string, number> = {
  FREE: 100,
  STARTER: 1000,
  BUSINESS: 10000,
  ENTERPRISE: Infinity,
};

export const collectUsage = createWorkflowJob({
  name: "collect-usage",
  body: (_input: CollectUsageInput) => ({
    usageItems: [
      { metric: "api-calls", totalQuantity: 1500 },
      { metric: "storage-gb", totalQuantity: 25 },
    ],
    totalItems: 2,
  }),
});

export const calculateCharges = createWorkflowJob({
  name: "calculate-charges",
  body: (input: CalculateChargesInput) => {
    const baseCharge = input.monthlyRate;
    const threshold = overageThresholds[input.plan] ?? 100;

    const overageCharge = input.usageItems.reduce(
      (sum, item) => sum + Math.max(0, item.totalQuantity - threshold) * 0.01,
      0,
    );

    return {
      baseCharge,
      overageCharge,
      totalCharge: baseCharge + overageCharge,
    };
  },
});

export const processBilling = createWorkflowJob({
  name: "process-billing",
  body: async (input: ProcessBillingInput) => {
    const usageResult = await collectUsage.trigger({
      organizationId: input.organizationId,
      billingPeriod: input.billingPeriod,
    });

    const chargeResult = await calculateCharges.trigger({
      usageItems: usageResult.usageItems,
      plan: input.plan,
      monthlyRate: input.monthlyRate,
    });

    return {
      success: true,
      organizationId: input.organizationId,
      totalCharge: chargeResult.totalCharge,
      usageSummary: {
        items: usageResult.usageItems,
        totalItems: usageResult.totalItems,
      },
      billingPeriod: input.billingPeriod,
    };
  },
});

export default createWorkflow({
  name: "billing-cycle",
  mainJob: processBilling,
});
