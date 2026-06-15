import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const loadCustomer = createWorkflowJob({
  name: "load-customer",
  body: async (input: { customerId: string }) => {
    return {
      id: input.customerId,
      email: "ada@example.com",
      plan: "pro" as const,
    };
  },
});

export const sendWelcome = createWorkflowJob({
  name: "send-welcome",
  body: async (input: { customerId: string; email: string }) => {
    return {
      customerId: input.customerId,
      receiptId: `welcome-${input.customerId}`,
      deliveredTo: input.email,
    };
  },
});

export const onboardCustomer = createWorkflowJob({
  name: "onboard-customer",
  body: async (input: { customerId: string }) => {
    const customer = await loadCustomer.trigger({ customerId: input.customerId });
    const welcome = await sendWelcome.trigger({
      customerId: customer.id,
      email: customer.email,
    });

    return {
      customerId: customer.id,
      plan: customer.plan,
      receiptId: welcome.receiptId,
    };
  },
});

export default createWorkflow({
  name: "customer-onboarding",
  mainJob: onboardCustomer,
});
