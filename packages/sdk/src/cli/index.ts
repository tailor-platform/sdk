#!/usr/bin/env node

import { register } from "node:module";
import { defineCommand, runMain } from "politty";
import { withCompletionCommand } from "politty/completion";
import { apiCommand } from "./commands/api";
import { applyCommand } from "./commands/apply";
import { crashReportCommand } from "./commands/crash-report";
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
import { initCrashReporting } from "./crash-report";
import { queryCommand } from "./query";
import { readPackageJson } from "./shared/package-json";

register("tsx", import.meta.url, { data: {} });

// Runs before withCommonArgs loads --env-file, so env file overrides for
// TAILOR_CRASH_REPORTS_* are not available for early startup failures.
// This is intentional: we want crash reporting active before argument parsing,
// and env files require parsing to be complete. Shell-level env vars still work.
initCrashReporting();

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
      "crash-report": crashReportCommand,
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
      query: queryCommand,
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
