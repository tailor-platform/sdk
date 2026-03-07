import { defineCommand, runCommand } from "politty";
import { listCommand } from "./list";
import { sendCommand } from "./send";

export const crashReportCommand = defineCommand({
  name: "crash-report",
  description: "Manage crash reports.",
  subCommands: {
    send: sendCommand,
    list: listCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
