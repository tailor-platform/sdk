import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { logsCommand } from "./logs";
import { runFunctionCommand } from "./run";
import { scriptCommand } from "./script";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    get: getCommand,
    list: listCommand,
    logs: logsCommand,
    run: runFunctionCommand,
    script: scriptCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});
