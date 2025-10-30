import { defineCommand } from "citty";
import { currentCommand } from "./current";
import { listCommand } from "./list";
import { useCommand } from "./use";

export interface UserInfo {
  user: string;
  tokenExpiresAt: string;
}

export const userCommand = defineCommand({
  meta: {
    name: "user",
    description: "Manage Tailor Platform users",
  },
  subCommands: {
    current: currentCommand,
    list: listCommand,
    use: useCommand,
  },
});
