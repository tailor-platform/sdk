import { defineCommand, runCommand } from "politty";
import { listCommand } from "./list";
import { tokenCommand } from "./token";

export const machineuserCommand = defineCommand({
  name: "machineuser",
  description: "Manage machine users",
  subCommands: {
    list: listCommand,
    token: tokenCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
