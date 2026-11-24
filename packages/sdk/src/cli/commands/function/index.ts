import { defineCommand } from "@politty/zod";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { logsCommand } from "./logs";
import { runFunctionCommand } from "./run";
import { scaffoldCommand } from "./scaffold";

export const functionCommand = defineCommand({
  name: "function",
  description: "Manage functions",
  subCommands: {
    get: getCommand,
    list: listCommand,
    logs: logsCommand,
    run: runFunctionCommand,
    script: scaffoldCommand,
  },
  defaultSubCommand: "list",
});
