import { defineCommand } from "politty";
import { statusCommand } from "./status";
import { tokenCommand } from "./token";

export const authCommand = defineCommand({
  name: "auth",
  description: "Authentication helpers for scripts and plugins.",
  subCommands: {
    status: statusCommand,
    token: tokenCommand,
  },
});
