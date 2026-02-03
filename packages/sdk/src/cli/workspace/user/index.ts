import { defineCommand, runCommand } from "politty";
import { inviteCommand } from "./invite";
import { listCommand } from "./list";
import { removeCommand } from "./remove";
import { updateCommand } from "./update";

export const userCommand = defineCommand({
  name: "user",
  description: "Manage workspace users",
  subCommands: {
    invite: inviteCommand,
    list: listCommand,
    remove: removeCommand,
    update: updateCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
