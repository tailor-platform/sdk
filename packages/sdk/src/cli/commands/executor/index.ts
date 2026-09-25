import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { getCommand } from "./get";
import { jobsCommand } from "./jobs";
import { listCommand } from "./list";
import { triggerCommand } from "./trigger";
import { webhookCommand } from "./webhook";

export const executorCommand = defineCommand({
  name: "executor",
  description: "Manage executors",
  subCommands: {
    trigger: triggerCommand,
    jobs: jobsCommand,
    list: listCommand,
    get: getCommand,
    webhook: webhookCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});
