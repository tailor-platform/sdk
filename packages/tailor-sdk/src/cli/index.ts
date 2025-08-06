#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "citty";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";
import { commandArgs, type CommandArgs } from "./args.js";
import { initCommand } from "./init.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getTsxPath(): Promise<{
  type: "bin" | "module" | "npx";
  path: string;
} | null> {
  // First try to find tsx in node_modules/.bin
  const localTsxPath = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  if (existsSync(localTsxPath)) {
    return { type: "bin", path: localTsxPath };
  }

  // For pnpm, try to find the actual tsx module in .pnpm directory
  const pnpmDir = path.join(process.cwd(), "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    // Look for tsx in .pnpm directory
    const dirs = readdirSync(pnpmDir);
    const tsxDir = dirs.find((dir) => dir.startsWith("tsx@"));
    if (tsxDir) {
      const tsxPath = path.join(
        pnpmDir,
        tsxDir,
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      if (existsSync(tsxPath)) {
        return { type: "module", path: tsxPath };
      }
    }
  }

  // Check if tsx is available via npx
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", "--version"], {
      stdio: "ignore",
    });

    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ type: "npx", path: "npx" });
      } else {
        resolve(null);
      }
    });
  });
}

const exec: (...args: CommandArgs) => Promise<void> = async (
  command,
  options,
) => {
  try {
    const tsxInfo = await getTsxPath();
    if (!tsxInfo) {
      console.error("Error: tsx is not installed or not available in PATH.");
      process.exit(1);
    }

    const cliExecTsPath = path.join(__dirname, "exec.ts");
    const cliExecMjsPath = path.join(__dirname, "exec.js");
    const cliExecPath = existsSync(cliExecTsPath)
      ? cliExecTsPath
      : existsSync(cliExecMjsPath)
        ? cliExecMjsPath
        : null;
    if (!cliExecPath) {
      console.error(`Error: exec.ts or exec.js not found in ${__dirname}`);
      process.exit(1);
    }

    const argsDef = commandArgs[command];
    const args = [cliExecPath, command];
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

    let child;

    if (tsxInfo.type === "npx") {
      // Use npx
      child = spawn("npx", ["tsx", ...args], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    } else if (tsxInfo.type === "module") {
      // Use node directly with the tsx module
      child = spawn("node", [tsxInfo.path, ...args], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    } else {
      // Use shell for bin scripts
      child = spawn("sh", [tsxInfo.path, ...args], {
        stdio: "inherit",
        cwd: process.cwd(),
      });
    }

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
