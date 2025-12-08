import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { fetchCustomer } from "./jobs/fetch-customer";
import { sendNotification } from "./jobs/send-notification";
// Note: We're NOT importing generateReport and archiveData
// Those jobs should be completely excluded from the bundle

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { orderId: string; customerId: string }, { env }) => {
    // Log env for demonstration (env is embedded at bundle time)
    console.log("Environment:", env);

    // Fetch customer information using trigger
    const customer = await fetchCustomer.trigger({
      customerId: input.customerId,
    });

    if (!customer) {
      throw new Error(`Customer ${input.customerId} not found`);
    }

    // Send notification to customer using trigger
    const notification = await sendNotification.trigger({
      message: `Your order ${input.orderId} is being processed`,
      recipient: customer.email,
    });

    return {
      orderId: input.orderId,
      customerId: input.customerId,
      customerEmail: customer.email,
      notificationSent: notification.sent,
      processedAt: notification.timestamp,
    };
  },
});

export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
});
