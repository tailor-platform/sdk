#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  annotateTerminalError,
  createCommonArgs,
  defineCommand,
  loadEnvFilesFromArgv,
  logger,
  runMain,
  serializeError,
} from "@tailor-platform/sdk/cli";
import { reportPluginError } from "@tailor-platform/shared/plugin-error";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { z } from "zod";
import { setupSubCommands } from "./commands";
import { locatedMessage } from "./error-message";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await readPackageJSON(packageRoot);

const mainCommand = defineCommand({
  name: "tailor-setup",
  description:
    "Set up repository automation for your project. (beta)\n" +
    "Tailor CLI plugin: installed alongside the Tailor CLI, it runs as `tailor setup <command>`.",
  subCommands: setupSubCommands,
});

void runMain(mainCommand, {
  version: packageJson.version ?? "0.0.0",
  globalArgs: z.strictObject(createCommonArgs()),
  displayErrors: false,
  setup: () => loadEnvFilesFromArgv(process.argv.slice(2)),
  // Render errors the way the host CLI does: `setup` used to run inside it, so
  // dropping either branch would regress `--json` consumers and CLIError detail.
  cleanup: ({ error }) =>
    reportPluginError(error, { logger, serializeError, annotateTerminalError, locatedMessage }),
});
