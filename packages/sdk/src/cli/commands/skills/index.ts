import { defineCommand, runCommand } from "politty";
import { installCommand } from "./install";

export const skillsCommand = defineCommand({
  name: "skills",
  description: "Manage Tailor SDK agent skills.",
  subCommands: {
    install: installCommand,
  },
  async run() {
    await runCommand(installCommand, []);
  },
});
