#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "citty";
import { apiCommand } from "./api";
import { applyCommand } from "./apply";
import { consoleCommand } from "./console";
import { generateCommand } from "./generator";
import { initCommand } from "./init";
import { loginCommand } from "./login";
import { logoutCommand } from "./logout";
import { machineuserCommand } from "./machineuser";
import { oauth2clientCommand } from "./oauth2client";
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

export const mainCommand = defineCommand({
  meta: {
    name: Object.keys(packageJson.bin ?? {})[0] || "tailor-sdk",
    version: packageJson.version,
    description:
      packageJson.description || "Tailor CLI for managing Tailor Platform SDK applications",
  },
  subCommands: {
    api: apiCommand,
    apply: applyCommand,
    console: consoleCommand,
    generate: generateCommand,
    init: initCommand,
    login: loginCommand,
    logout: logoutCommand,
    machineuser: machineuserCommand,
    oauth2client: oauth2clientCommand,
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
});

runMain(mainCommand);
