import { defineCommand } from "@politty/zod";
import { executionsCommand } from "./executions";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { pruneCommand } from "./prune";
import { resumeCommand } from "./resume";
import { runCommand } from "./run";
import { scaffoldCommand } from "./scaffold";
import { startCommand } from "./start";
import { waitCommand } from "./wait";

export const workflowCommand = defineCommand({
  name: "workflow",
  description: "Manage workflows and workflow executions.",
  subCommands: {
    list: listCommand,
    get: getCommand,
    start: startCommand,
    run: runCommand,
    scaffold: scaffoldCommand,
    prune: pruneCommand,
    wait: waitCommand,
    executions: executionsCommand,
    resume: resumeCommand,
  },
  defaultSubCommand: "list",
});
