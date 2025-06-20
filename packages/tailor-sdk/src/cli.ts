#!/usr/bin/env node

import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "citty";
import type { WorkspaceConfig } from "./config";
import { Tailor } from "./tailor";
import { Workspace } from "./workspace";
import path from "node:path";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const jiti = createJiti(__filename, {
  interopDefault: true,
});

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const config = await jiti.import(configPath);

    if (!config || typeof config !== "object") {
      throw new Error(
        "Invalid Tailor config: config must export a default object",
      );
    }

    return config as WorkspaceConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to load config from ${configPath}: ${error.message}`,
      );
    }
    throw error;
  }
}

const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Tailor configuration to generate files",
  },
  args: {
    config: {
      type: "string",
      description: "Path to the Tailor config file",
      alias: "c",
    },
  },
  async run({ args }) {
    try {
      const sdkTempDir = path.join(process.cwd(), ".tailor-sdk");
      Tailor.init(sdkTempDir);

      const configPath =
        args.config || path.join(process.cwd(), "tailor.config.ts");
      const config = await loadConfig(configPath);

      const workspace = new Workspace(config.name);
      const app = workspace.newApplication(config.app.name);
      app.defineTailorDB(config.app.db);
      app.defineResolver(config.app.resolver);
      app.defineAuth(config.app.auth);

      await workspace.ctlApply();
      console.log("Configuration applied successfully.");
    } catch (error) {
      console.error("Failed to apply configuration:", error);
      process.exit(1);
    }
  },
});

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
  },
});

runMain(mainCommand);
