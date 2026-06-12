import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";
import { format } from "date-fns";

export const fetchDetails = createWorkflowJob({
  name: "fetch-details",
  body: async (input: { orderId: string }) => {
    return { orderId: input.orderId, status: "found" };
  },
});

export const notifyUser = createWorkflowJob({
  name: "notify-user",
  body: async (_input: { message: string; recipient: string }) => {
    const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
    return { sent: true, timestamp };
  },
});

export const processOrder = createWorkflowJob({
  name: "process-order",
  body: async (input: { orderId: string; userEmail: string }) => {
    const details = await fetchDetails.trigger({ orderId: input.orderId });
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- trigger return may be undefined when the upstream job produces no value
    if (!details) {
      throw new Error(`Order ${input.orderId} not found`);
    }

    const notification = await notifyUser.trigger({
      message: `Order ${input.orderId} processed`,
      recipient: input.userEmail,
    });

    return {
      orderId: input.orderId,
      status: details.status,
      notified: notification.sent,
      processedAt: notification.timestamp,
    };
  },
});

export default createWorkflow({
  name: "order-processing",
  mainJob: processOrder,
});
