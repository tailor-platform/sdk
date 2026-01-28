import { defineCommand, runCommand } from "politty";
import { createCommand } from "./create";
import { deleteCommand } from "./delete";
import { listCommand } from "./list";
import { updateCommand } from "./update";

export interface ProfileInfo {
  name: string;
  user: string;
  workspaceId: string;
}

export const profileCommand = defineCommand({
  name: "profile",
  description: "Manage workspace profiles (user + workspace combinations)",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
  },
  async run() {
    await runCommand(listCommand, []);
  },
});
