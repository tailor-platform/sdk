#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "citty";
import { readPackageJSON } from "pkg-types";
import { applyCommand } from "./apply";
import { generateCommand } from "./generator";
import { initCommand } from "./init";
import { loginCommand } from "./login";
import { logoutCommand } from "./logout";
import { machineuserCommand } from "./machineuser";
import { profileCommand } from "./profile";
import { showCommand } from "./show";
import { userCommand } from "./user";
import { workspaceCommand } from "./workspace";

register("tsx", import.meta.url, { data: {} });

const packageJson = await readPackageJSON(import.meta.url);

const mainCommand = defineCommand({
  meta: {
    name: packageJson.name,
    version: packageJson.version,
    description:
      packageJson.description ||
      "Tailor CLI for managing Tailor SDK applications",
  },
  subCommands: {
    apply: applyCommand,
    generate: generateCommand,
    init: initCommand,
    login: loginCommand,
    logout: logoutCommand,
    machineuser: machineuserCommand,
    profile: profileCommand,
    show: showCommand,
    user: userCommand,
    workspace: workspaceCommand,
  },
});

runMain(mainCommand);
