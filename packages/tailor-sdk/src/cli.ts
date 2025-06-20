#!/usr/bin/env node

import { readPackageJSON } from "pkg-types";
import { defineCommand, runMain } from "citty";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkTsxAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("tsx", ["--version"], {
      stdio: "ignore",
      shell: true,
    });

    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
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
      // tsxが利用可能か確認
      const tsxAvailable = await checkTsxAvailable();
      if (!tsxAvailable) {
        console.error("Error: tsx is not installed or not available in PATH.");
        console.error("Please install tsx globally: npm install -g tsx");
        process.exit(1);
      }

      const cliApplyTsPath = path.join(__dirname, "cli-apply.ts");
      const cliApplyMjsPath = path.join(__dirname, "cli-apply.mjs");
      const cliApplyPath = existsSync(cliApplyTsPath)
        ? cliApplyTsPath
        : existsSync(cliApplyMjsPath)
          ? cliApplyMjsPath
          : null;
      if (!cliApplyPath) {
        console.error(
          `Error: cli-apply.ts or cli-apply.mjs not found in ${__dirname}`,
        );
        process.exit(1);
      }

      // configパスを決定
      const configPath = args.config || "tailor.config.ts";

      // tsxを使ってcli-apply.tsを実行
      const child = spawn("tsx", [cliApplyPath, configPath], {
        stdio: "inherit",
        shell: true,
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
