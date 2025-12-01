#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "citty";
import { applyCommand } from "./apply";
import { generateCommand } from "./generator";
import { initCommand } from "./init";
import { loginCommand } from "./login";
import { logoutCommand } from "./logout";
import { machineuserCommand } from "./machineuser";
import { readPackageJson } from "./package-json";
import { profileCommand } from "./profile";
import { removeCommand } from "./remove";
import { secretCommand } from "./secret";
import { showCommand } from "./show";
import { tailordbCommand } from "./tailordb";
import { userCommand } from "./user";
import { workspaceCommand } from "./workspace";

register("tsx", import.meta.url, { data: {} });

const packageJson = await readPackageJson();

const mainCommand = defineCommand({
  meta: {
    name: packageJson.name,
    version: packageJson.version,
    description:
      packageJson.description ||
      "Tailor CLI for managing Tailor Platform SDK applications",
  },
  subCommands: {
    apply: applyCommand,
    generate: generateCommand,
    init: initCommand,
    login: loginCommand,
    logout: logoutCommand,
    machineuser: machineuserCommand,
    profile: profileCommand,
    remove: removeCommand,
    show: showCommand,
    tailordb: tailordbCommand,
    secret: secretCommand,
    user: userCommand,
    workspace: workspaceCommand,
  },
});

runMain(mainCommand);
