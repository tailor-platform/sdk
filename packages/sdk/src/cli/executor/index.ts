import { defineCommand } from "politty";
import { jobsCommand } from "./jobs";
import { triggerCommand } from "./trigger";

export const executorCommand = defineCommand({
  name: "executor",
  description: "Manage executors",
  subCommands: {
    jobs: jobsCommand,
    trigger: triggerCommand,
  },
});
