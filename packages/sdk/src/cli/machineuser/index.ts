import { defineCommand, runCommand } from "citty";
import { listCommand } from "./list";
import { tokenCommand } from "./token";

export const machineuserCommand = defineCommand({
  meta: {
    name: "machineuser",
    description: "Manage machine users",
  },
  subCommands: {
    list: listCommand,
    token: tokenCommand,
  },
  async run() {
    await runCommand(listCommand, { rawArgs: [] });
  },
});
