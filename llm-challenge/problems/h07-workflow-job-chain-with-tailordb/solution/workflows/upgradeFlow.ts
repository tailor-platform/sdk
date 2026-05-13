import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../generated/tailordb";

const upgradePriceTable: Record<string, Record<string, number>> = {
  free: { pro: 20, enterprise: 80 },
  pro: { enterprise: 60 },
};

export const loadAccount = createWorkflowJob({
  name: "load-account",
  body: async (input: { accountId: string }) => {
    const row = await getDB("tailordb")
      .selectFrom("Account")
      .select(["tier"])
      .where("id", "=", input.accountId)
      .executeTakeFirstOrThrow();
    return { currentTier: row.tier };
  },
});

export const computeUpgradeCost = createWorkflowJob({
  name: "compute-upgrade-cost",
  body: async (input: { currentTier: string; targetTier: string }) => {
    const cost = upgradePriceTable[input.currentTier]?.[input.targetTier] ?? 0;
    return { cost };
  },
});

export const processUpgrade = createWorkflowJob({
  name: "process-upgrade",
  body: async (input: { accountId: string; targetTier: string }) => {
    const { currentTier } = await loadAccount.trigger({ accountId: input.accountId });
    const { cost } = await computeUpgradeCost.trigger({
      currentTier,
      targetTier: input.targetTier,
    });
    return {
      accountId: input.accountId,
      currentTier,
      targetTier: input.targetTier,
      cost,
    };
  },
});

export default createWorkflow({
  name: "upgrade-flow",
  mainJob: processUpgrade,
});
