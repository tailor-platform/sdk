import { defineCommand } from "citty";
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
  meta: {
    name: "profile",
    description:
      "Manage Tailor Platform profiles (user + workspace combinations)",
  },
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
  },
});
