import { defineCommand, runCommand } from "politty";
import { executionsCommand } from "./executions";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { resumeCommand } from "./resume";
import { startCommand } from "./start";
import { waitCommand } from "./wait";

export const workflowCommand = defineCommand({
  name: "workflow",
  description: "Manage workflows and workflow executions.",
  subCommands: {
    list: listCommand,
    get: getCommand,
    start: startCommand,
    wait: waitCommand,
    executions: executionsCommand,
    resume: resumeCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
