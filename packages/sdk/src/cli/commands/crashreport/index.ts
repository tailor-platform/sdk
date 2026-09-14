import { defineCommand } from "@politty/zod";
import { runDefaultSubCommand } from "#/cli/shared/command";
import { listCommand } from "./list";
import { sendCommand } from "./send";

export const crashReportCommand = defineCommand({
  name: "crashreport",
  description: "Manage crash reports.",
  subCommands: {
    list: listCommand,
    send: sendCommand,
  },
  async run() {
    await runDefaultSubCommand(listCommand);
  },
});
