import { defineCommand } from "@politty/valibot";
import { tokenCommand } from "./token";

export const authCommand = defineCommand({
  name: "auth",
  description: "Authentication helpers for scripts and plugins.",
  subCommands: {
    token: tokenCommand,
  },
});
