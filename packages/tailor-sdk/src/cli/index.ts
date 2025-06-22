#!/usr/bin/env node

import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "citty";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import {
  applyCommandArgs,
  generateCommandArgs,
  type CommandArgs,
} from "./args.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkTsxAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tsx", ["--version"], {
      stdio: "ignore",
    });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

const exec: (...args: CommandArgs) => Promise<void> = async (
  command,
  options,
) => {
  try {
    const tsxAvailable = await checkTsxAvailable();
    if (!tsxAvailable) {
      console.error("Error: tsx is not installed or not available in PATH.");
      console.error("Please install tsx globally: npm install -g tsx");
      process.exit(1);
    }

    const cliExecTsPath = path.join(__dirname, "exec.ts");
    const cliExecMjsPath = path.join(__dirname, "exec.mjs");
    const cliExecPath = existsSync(cliExecTsPath)
      ? cliExecTsPath
      : existsSync(cliExecMjsPath)
        ? cliExecMjsPath
        : null;
    if (!cliExecPath) {
      console.error(`Error: exec.ts or exec.mjs not found in ${__dirname}`);
      process.exit(1);
    }

    const args = [
      cliExecPath,
      command,
      "-c",
      options.config || "tailor.config.ts",
    ];
    if (options.dryRun) {
      args.push("-d");
    }

    const child = spawn("tsx", args, {
      stdio: "inherit",
      cwd: process.cwd(),
    });

    child.on("error", (error) => {
      console.error("Failed to execute tsx:", error);
      process.exit(1);
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        process.exit(code || 1);
      }
    });
  } catch (error) {
    console.error(`Failed to ${command} configuration:`, error);
    process.exit(1);
  }
};

const applyCommand = defineCommand({
  meta: {
    name: "apply",
    description: "Apply Tailor configuration to generate files",
  },
  args: applyCommandArgs,
  async run({ args }) {
    await exec("apply", args);
  },
});

const generateCommand = defineCommand({
  meta: {
    name: "generate",
    description: "Generate files using Tailor configuration",
  },
  args: generateCommandArgs,
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
  },
});

runMain(mainCommand);
