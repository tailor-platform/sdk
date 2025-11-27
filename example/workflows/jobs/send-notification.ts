import { createWorkflowJob } from "@tailor-platform/sdk";
import { format } from "date-fns";

export const sendNotification = createWorkflowJob({
  name: "send-notification",
  body: async (input: { message: string; recipient: string }) => {
    // Simulate sending notification
    const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
    console.log(
      `[${timestamp}] Sending to ${input.recipient}: ${input.message}`,
    );
    return { sent: true, timestamp };
  },
});
