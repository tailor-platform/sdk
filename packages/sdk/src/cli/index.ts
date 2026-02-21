#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "politty";
import { withCompletionCommand } from "politty/completion";
import { apiCommand } from "./api";
import { applyCommand } from "./apply";
import { executorCommand } from "./executor";
import { functionCommand } from "./function";
import { generateCommand } from "./generator";
import { initCommand } from "./init";
import { loginCommand } from "./login";
import { logoutCommand } from "./logout";
import { machineuserCommand } from "./machineuser";
import { manifestCommand } from "./manifest";
import { oauth2clientCommand } from "./oauth2client";
import { openCommand } from "./open";
import { profileCommand } from "./profile";
import { removeCommand } from "./remove";
import { secretCommand } from "./secret";
import { showCommand } from "./show";
import { staticwebsiteCommand } from "./staticwebsite";
import { tailordbCommand } from "./tailordb";
import { userCommand } from "./user";
import { readPackageJson } from "./utils/package-json";
import { workflowCommand } from "./workflow";
import { workspaceCommand } from "./workspace";

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
      manifest: manifestCommand,
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
