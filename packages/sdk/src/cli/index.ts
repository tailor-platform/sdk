#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "politty";
import { withCompletionCommand } from "politty/completion";
import { apiCommand } from "./commands/api";
import { applyCommand } from "./commands/apply";
import { executorCommand } from "./commands/executor";
import { functionCommand } from "./commands/function";
import { generateCommand } from "./commands/generate";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { machineuserCommand } from "./commands/machineuser";
import { oauth2clientCommand } from "./commands/oauth2client";
import { openCommand } from "./commands/open";
import { profileCommand } from "./commands/profile";
import { removeCommand } from "./commands/remove";
import { secretCommand } from "./commands/secret";
import { showCommand } from "./commands/show";
import { staticwebsiteCommand } from "./commands/staticwebsite";
import { tailordbCommand } from "./commands/tailordb";
import { userCommand } from "./commands/user";
import { workflowCommand } from "./commands/workflow";
import { workspaceCommand } from "./commands/workspace";
import { readPackageJson } from "./shared/package-json";

register("tsx", import.meta.url, { data: {} });

const packageJson = await readPackageJson();
const cliName = Object.keys(packageJson.bin ?? {})[0] || "tailor-sdk";

export const mainCommand = withCompletionCommand(
  defineCommand({
    name: cliName,
    description:
      packageJson.description || "Tailor CLI for managing Tailor Platform SDK applications",
    subCommands: {
      api: apiCommand,
      apply: applyCommand,
      executor: executorCommand,
      function: functionCommand,
      generate: generateCommand,
      init: initCommand,
      login: loginCommand,
      logout: logoutCommand,
      machineuser: machineuserCommand,
      oauth2client: oauth2clientCommand,
      open: openCommand,
      profile: profileCommand,
      remove: removeCommand,
      secret: secretCommand,
      show: showCommand,
      staticwebsite: staticwebsiteCommand,
      tailordb: tailordbCommand,
      user: userCommand,
      workflow: workflowCommand,
      workspace: workspaceCommand,
    },
  }),
);

runMain(mainCommand, { version: packageJson.version });
