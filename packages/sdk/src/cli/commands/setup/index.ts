import { defineCommand } from "politty";
import { githubCommand } from "./github";

export const setupCommand = defineCommand({
  name: "setup",
  description: "Set up project infrastructure.",
  subCommands: {
    github: githubCommand,
  },
});
