#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "citty";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { commandArgs, type CommandArgs } from "./args.js";
import { initCommand } from "./init.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkTsxAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "--version"], {
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

    const argsDef = commandArgs[command];
    const args = ["tsx", cliExecPath, command];
    Object.entries(argsDef).forEach(([key, value]) => {
      if (key in options) {
        if (value.type === "boolean") {
          if ((options as any)[key]) {
            args.push(`--${key}`);
          }
        } else if (value.type === "string") {
          args.push(`--${key}`, (options as any)[key]);
        } else {
          args.push((options as any)[key]);
        }
      }
    });

    const child = spawn("npx", args, {
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
  },
});

runMain(mainCommand);
