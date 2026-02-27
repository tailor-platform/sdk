import { createWorkflowJob } from "@tailor-platform/sdk";

export const setupAccount = createWorkflowJob({
  name: "setup-account",
  body: (input: { email: string; name: string; plan: string }) => ({
    accountId: `acc-${input.email.split("@")[0]}`,
    email: input.email,
    name: input.name,
    plan: input.plan,
  }),
});

export const assignDefaults = createWorkflowJob({
  name: "assign-defaults",
  body: (input: { accountId: string; plan: string }) => {
    const quotas: Record<string, number> = {
      free: 100,
      basic: 1000,
      premium: 10000,
      enterprise: 100000,
    };
    return {
      accountId: input.accountId,
      storageQuota: quotas[input.plan] ?? 100,
      apiRateLimit: input.plan === "enterprise" ? 10000 : 1000,
    };
  },
});

export const onboardUser = createWorkflowJob({
  name: "onboard-user",
  body: async (input: { email: string; name: string; plan: string; referralCode: string }) => {
    const account = await setupAccount.trigger({
      email: input.email,
      name: input.name,
      plan: input.plan,
    });

    const defaults = await assignDefaults.trigger({
      accountId: account.accountId,
      plan: input.plan,
    });

    return {
      accountId: account.accountId,
      email: input.email,
      plan: input.plan,
      storageQuota: defaults.storageQuota,
      apiRateLimit: defaults.apiRateLimit,
      referralCode: input.referralCode,
    };
  },
});
