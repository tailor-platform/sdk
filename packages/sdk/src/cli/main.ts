#!/usr/bin/env node

import { dirname, resolve } from "pathe";
import { resolvePackageJSON } from "pkg-types";
import { defineCommand, runCommand, runMain, type AnyCommand } from "politty";
import { withCompletionCommand } from "politty/completion";
import { withSkillCommand } from "politty/skill";
import { z } from "zod";
import { apiCommand } from "./commands/api";
import { authCommand } from "./commands/auth";
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
import { pluginCommand } from "./commands/plugin";
import { profileCommand } from "./commands/profile";
import { removeCommand } from "./commands/remove";
import { secretCommand } from "./commands/secret";
import { setupCommand } from "./commands/setup";
import { showCommand } from "./commands/show";
import { staticwebsiteCommand } from "./commands/staticwebsite";
import { tailordbCommand } from "./commands/tailordb";
import { upgradeCommand } from "./commands/upgrade";
import { userCommand } from "./commands/user";
import { workflowCommand } from "./commands/workflow";
import { workspaceCommand } from "./commands/workspace";
import { initCrashReporting } from "./crashreport";
import { queryCommand } from "./query";
import { commonArgs, isVerbose } from "./shared/args";
import { serializeError } from "./shared/error-json";
import { isCLIError, typeOnlyImportHint } from "./shared/errors";
import { logger, styles } from "./shared/logger";
import { readPackageJson } from "./shared/package-json";
import { dispatchPluginWithInstallHint } from "./shared/plugin";
import { registerTsHook } from "./shared/register-ts-hook";

await registerTsHook(new URL("./ts-hook.mjs", import.meta.url));

// Runs before globalArgs effects load --env-file, so env file overrides for
// TAILOR_CRASH_REPORTS_* are not available for early startup failures.
// This is intentional: we want crash reporting active before argument parsing,
// and env files require parsing to be complete. Shell-level env vars still work.
initCrashReporting();

const packageJson = await readPackageJson();
const cliName = Object.keys(packageJson.bin ?? {})[0] || "tailor";
const packageName = packageJson.name ?? "@tailor-platform/sdk";
const packageJsonPath = await resolvePackageJSON(import.meta.url);
const bundledSkillsDir = resolve(dirname(packageJsonPath), "agent-skills");

function defaultSkillsRunToAdd(command: AnyCommand): AnyCommand {
  const add = (command.subCommands ?? {}).add as AnyCommand;
  return {
    ...command,
    async run() {
      const result = await runCommand(add, []);
      if (!result.success) {
        throw result.error;
      }
    },
  };
}

const commandWithSkills = withSkillCommand(
  defineCommand({
    name: cliName,
    description:
      packageJson.description || "Tailor CLI for managing Tailor Platform SDK applications",
    notes: `CLI plugins (beta): an unknown subcommand is dispatched to an external plugin executable named \`${cliName}-<name>\` (found on your PATH or in node_modules/.bin), similar to \`gh\` extensions.
Run \`${cliName} plugin list\` to see which plugins are installed and where they resolve from.`,
    subCommands: {
      api: apiCommand,
      auth: authCommand,
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
      plugin: pluginCommand,
      profile: profileCommand,
      query: queryCommand,
      remove: removeCommand,
      secret: secretCommand,
      setup: setupCommand,
      show: showCommand,
      staticwebsite: staticwebsiteCommand,
      tailordb: tailordbCommand,
      upgrade: upgradeCommand,
      user: userCommand,
      workflow: workflowCommand,
      workspace: workspaceCommand,
    },
  }),
  {
    sourceDir: bundledSkillsDir,
    package: packageName,
    mode: "copy",
    descriptionAppend: false,
    // strip unknown keys
    globalArgs: z.object(commonArgs),
    commandMap: { add: ["add"], remove: ["remove"] },
    unknownKeys: "strict",
    descriptions: {
      skills: "Manage Tailor SDK agent skills.",
      add: "Install Tailor SDK agent skills.",
      list: "List Tailor SDK agent skills.",
      remove: "Remove installed Tailor SDK agent skills.",
      sync: "Remove and reinstall Tailor SDK agent skills.",
    },
  },
);

export const mainCommand = withCompletionCommand({
  ...commandWithSkills,
  subCommands: {
    ...commandWithSkills.subCommands,
    skills: defaultSkillsRunToAdd(commandWithSkills.subCommands.skills),
  },
});

void runMain(mainCommand, {
  version: packageJson.version,
  // strip unknown keys
  globalArgs: z.object(commonArgs),
  displayErrors: false,
  // CLI plugin dispatch: an unknown subcommand at any level execs the external
  // `tailor-<path...>-<name>` binary, forwarding args and injecting context.
  onUnknownSubcommand: ({ commandPath, name, args }) =>
    dispatchPluginWithInstallHint({
      commandPath,
      name,
      args,
      cliName,
      profile: process.env.TAILOR_PLATFORM_PROFILE,
    }),
  cleanup: async ({ error }) => {
    if (error) {
      if (logger.jsonMode) {
        logger.log(serializeError(error, { includeStack: isVerbose() }));
      } else if (isCLIError(error)) {
        logger.log(error.format());
        if (isVerbose() && error.stack) {
          logger.debug(`\nStack trace:\n${error.stack}`);
        }
      } else if (error instanceof Error) {
        logger.error(error.message);
        const hint = typeOnlyImportHint(error);
        if (hint) {
          logger.log(`  ${styles.info("Suggestion:")} ${hint}`);
        }
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
