#!/usr/bin/env node

import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "citty";
import * as fs from "node:fs";
import * as path from "node:path";
import { register } from "node:module";
import * as dotenv from "dotenv";

import { apply, generate } from "./api.js";
import { commandArgs, type CommandArgs } from "./args.js";
import { initCommand } from "./init.js";
import { workspaceCommand } from "./workspace";
import { loginCommand } from "./login.js";
import { logoutCommand } from "./logout.js";

register("tsx", import.meta.url, { data: {} });

const exec: (...args: CommandArgs) => Promise<void> = async (
  command,
  options,
) => {
  try {
    if (options["env-file"]) {
      const envPath = path.resolve(process.cwd(), options["env-file"]);
      if (!fs.existsSync(envPath)) {
        throw new Error(`Environment file not found: ${envPath}`);
      }
      dotenv.config({ path: envPath });
    }

    const configPath = options.config || "tailor.config.ts";

    if (command === "apply") {
      await apply(configPath, options);
    } else if (command === "generate") {
      await generate(configPath, options);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(`Failed to ${command} configuration:`, error);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
};

const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Tailor configuration to generate files",
  },
  args: commandArgs.apply,
  async run({ args }) {
    await exec("apply", args);
  },
});

const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Generate files using Tailor configuration",
  },
  args: commandArgs.generate,
  async run({ args }) {
    await exec("generate", args);
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
    generate: generateCommand,
    init: initCommand,
    workspace: workspaceCommand,
    login: loginCommand,
    logout: logoutCommand,
  },
});

runMain(mainCommand);
