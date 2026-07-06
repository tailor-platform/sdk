import { defineCommand } from "politty";
import { tokenCommand } from "./token";

export const authCommand = defineCommand({
  name: "auth",
  description: "Authentication helpers for scripts and plugins.",
  subCommands: {
    token: tokenCommand,
  },
});
