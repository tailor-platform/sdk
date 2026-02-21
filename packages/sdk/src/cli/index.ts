#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "politty";
import { createCompletionCommand } from "politty/completion";
import { apiCommand } from "./api";
import { applyCommand } from "./apply";
import { executorCommand } from "./executor";
import { functionCommand } from "./function";
import { generateCommand } from "./generator";
import { initCommand } from "./init";
import { loginCommand } from "./login";
import { logoutCommand } from "./logout";
import { machineuserCommand } from "./machineuser";
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
import type { AnyCommand } from "politty";

register("tsx", import.meta.url, { data: {} });

const packageJson = await readPackageJson();
const cliName = Object.keys(packageJson.bin ?? {})[0] || "tailor-sdk";

export const mainCommand: AnyCommand = defineCommand({
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
    completion: async () => createCompletionCommand(mainCommand, cliName),
  },
});

runMain(mainCommand, { version: packageJson.version });
