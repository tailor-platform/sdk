import { defineCommand } from "citty";
import { jobsCommand } from "./jobs";
import { triggerCommand } from "./trigger";

export const executorCommand = defineCommand({
  meta: {
    name: "executor",
    description: "Manage executors",
  },
  subCommands: {
    jobs: jobsCommand,
    trigger: triggerCommand,
  },
});
