#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import {
  annotateTerminalError,
  createCommonArgs,
  errorToJson,
  loadEnvFilesFromArgv,
  logger,
  runMain,
  serializeError,
} from "@tailor-platform/sdk/cli";
import { reportPluginError } from "@tailor-platform/shared/plugin-error";
import * as path from "pathe";
import { readPackageJSON } from "pkg-types";
import { z } from "zod";
import { uiCommand } from "./serve";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = await readPackageJSON(packageRoot);

void runMain(uiCommand, {
  version: packageJson.version ?? "0.0.0",
  globalArgs: z.strictObject(createCommonArgs()),
  displayErrors: false,
  setup: () => loadEnvFilesFromArgv(process.argv.slice(2)),
  cleanup: ({ error }) =>
    reportPluginError(error, {
      logger,
      serializeError,
      annotateTerminalError,
      locatedMessage: (e) => {
        const { message } = errorToJson(e).error;
        return typeof message === "string" ? message : e.message;
      },
    }),
});
