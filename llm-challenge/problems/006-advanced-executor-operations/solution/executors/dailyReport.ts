import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily-report",
  description: "Generates a daily report at 9 AM JST",
  trigger: scheduleTrigger({
    cron: "0 9 * * *",
    timezone: "Asia/Tokyo",
  }),
  operation: {
    kind: "function",
    body: async () => {
      console.log("Generating daily report");
    },
  },
});
