import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { healthCommand } from "./health";
import { listCommand } from "./list";

export const appCommand = defineCommand({
  name: "app",
  description: "Manage workspace applications",
  subCommands: {
    health: healthCommand,
    list: listCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});
