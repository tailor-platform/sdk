#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  createCommonArgs,
  defineCommand,
  logger,
  runMain,
  serializeError,
} from "@tailor-platform/sdk/cli";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { z } from "zod";
import { setupSubCommands } from "./commands";

function hasFormat(error: unknown): error is { format(): string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { format?: unknown }).format === "function"
  );
}

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
  // strip unknown keys
  globalArgs: z.object(createCommonArgs()),
  displayErrors: false,
  // Render errors the way the host CLI does: `setup` used to run inside it, so
  // dropping either branch would regress `--json` consumers and CLIError detail.
  cleanup: ({ error }) => {
    if (!error) return;
    if (logger.jsonMode) {
      logger.log(serializeError(error, { includeStack: logger.verbose }));
    } else if (hasFormat(error)) {
      logger.log(error.format());
    } else if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error(`Unknown error: ${String(error)}`);
    }
    if (error instanceof Error && error.stack) {
      logger.debug(`\nStack trace:\n${error.stack}`);
    }
  },
});
