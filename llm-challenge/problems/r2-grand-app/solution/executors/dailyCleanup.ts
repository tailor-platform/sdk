import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily-cleanup",
  description: "Daily cleanup at 03:00 JST",
  trigger: scheduleTrigger({ cron: "0 3 * * *", timezone: "Asia/Tokyo" }),
  operation: {
    kind: "function",
    body: async () => {
      console.log("daily cleanup");
    },
  },
});
