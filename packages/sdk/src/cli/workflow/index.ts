import { defineCommand, runCommand } from "politty";
import { executionsCommand } from "./executions";
import { getCommand } from "./get";
import { listCommand } from "./list";
import { resumeCommand } from "./resume";
import { startCommand } from "./start";

export const workflowCommand = defineCommand({
  name: "workflow",
  description: "Manage workflows",
  subCommands: {
    list: listCommand,
    get: getCommand,
    start: startCommand,
    executions: executionsCommand,
    resume: resumeCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
