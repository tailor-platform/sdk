#!/usr/bin/env node

import { defineCommand, runMain } from "politty";
import { withCompletionCommand } from "politty/completion";
import { z } from "zod";
import { apiCommand } from "./commands/api";
import { authconnectionCommand } from "./commands/authconnection";
import { crashReportCommand } from "./commands/crashreport";
import { deployCommand } from "./commands/deploy";
import { executorCommand } from "./commands/executor";
import { functionCommand } from "./commands/function";
import { generateCommand } from "./commands/generate";
import { initCommand } from "./commands/init";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { machineuserCommand } from "./commands/machineuser";
import { oauth2clientCommand } from "./commands/oauth2client";
import { openCommand } from "./commands/open";
import { organizationCommand } from "./commands/organization";
import { profileCommand } from "./commands/profile";
import { removeCommand } from "./commands/remove";
import { secretCommand } from "./commands/secret";
import { setupCommand } from "./commands/setup";
import { showCommand } from "./commands/show";
import { skillsCommand } from "./commands/skills";
import { staticwebsiteCommand } from "./commands/staticwebsite";
import { tailordbCommand } from "./commands/tailordb";
import { upgradeCommand } from "./commands/upgrade";
import { userCommand } from "./commands/user";
import { workflowCommand } from "./commands/workflow";
import { workspaceCommand } from "./commands/workspace";
import { initCrashReporting } from "./crashreport";
import { queryCommand } from "./query";
import { commonArgs, isVerbose } from "./shared/args";
import { isCLIError } from "./shared/errors";
import { logger } from "./shared/logger";
import { readPackageJson } from "./shared/package-json";
import { isNativeTypeScriptRuntime } from "./shared/runtime";

// Register tsx for TypeScript loading on Node.js.
// Bun and Deno handle TypeScript natively, so registration is skipped.
// tsx's own register() picks `module.registerHooks` on Node ≥ 24.11.1 / 25.1 / 26
// (avoiding the DEP0205 deprecation) and falls back to `module.register` on older runtimes.
if (!isNativeTypeScriptRuntime()) {
  const { register } = await import("tsx/esm/api");
  register();
}

// Runs before globalArgs effects load --env-file, so env file overrides for
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
      authconnection: authconnectionCommand,
      crashreport: crashReportCommand,
      deploy: deployCommand,
      executor: executorCommand,
      function: functionCommand,
      generate: generateCommand,
      init: initCommand,
      login: loginCommand,
      logout: logoutCommand,
      machineuser: machineuserCommand,
      oauth2client: oauth2clientCommand,
      open: openCommand,
      organization: organizationCommand,
      profile: profileCommand,
      query: queryCommand,
      remove: removeCommand,
      secret: secretCommand,
      setup: setupCommand,
      show: showCommand,
      skills: skillsCommand,
      staticwebsite: staticwebsiteCommand,
      tailordb: tailordbCommand,
      upgrade: upgradeCommand,
      user: userCommand,
      workflow: workflowCommand,
      workspace: workspaceCommand,
    },
  }),
);

runMain(mainCommand, {
  version: packageJson.version,
  globalArgs: z.object(commonArgs),
  displayErrors: false,
  cleanup: async ({ error }) => {
    if (error) {
      if (isCLIError(error)) {
        logger.log(error.format());
        if (isVerbose() && error.stack) {
          logger.debug(`\nStack trace:\n${error.stack}`);
        }
      } else if (error instanceof Error) {
        logger.error(error.message);
        if (isVerbose() && error.stack) {
          logger.debug(`\nStack trace:\n${error.stack}`);
        }
      } else {
        logger.error(`Unknown error: ${error}`);
      }

      // Report programming bugs (native error types that indicate code defects).
      // Skip domain errors like ConnectError, CIPromptError, and plain Error
      // used for user-facing validation/not-found messages.
      // Exclude SyntaxError/ReferenceError: at runtime these typically come from
      // dynamically imported user config files, not from SDK code.
      const shouldReport =
        !isCLIError(error) &&
        (!(error instanceof Error) || error instanceof TypeError || error instanceof RangeError);
      if (shouldReport) {
        // Lazy import to match shutdownTelemetry pattern and keep cleanup handler lightweight.
        const { reportCrash } = await import("#/cli/crashreport/index");
        await reportCrash(error, "handledError");
      }
    }
    const { shutdownTelemetry } = await import("#/cli/telemetry/index");
    await shutdownTelemetry();
  },
});
