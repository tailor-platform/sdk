#!/usr/bin/env tsx

import { defineCommand, runMain } from "citty";
import path from "node:path";
import type { WorkspaceConfig } from "../config";
import { apply, generate } from "../workspace";
import { applyCommandArgs, CommandArgs, generateCommandArgs } from "./args.js";

async function loadConfig(configPath: string): Promise<WorkspaceConfig> {
  try {
    const resolvedPath = path.resolve(process.cwd(), configPath);
    const configModule = await import(resolvedPath);

    if (!configModule || !configModule.default) {
      throw new Error("Invalid Tailor config module: default export not found");
    }

    return configModule.default as WorkspaceConfig;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Cannot find module")
    ) {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    throw error;
  }
}

const exec: (...args: CommandArgs) => Promise<void> = async (
  command,
  options,
) => {
  try {
    const configPath = options.config || "tailor.config.ts";
    const config = await loadConfig(configPath);

    if (command === "apply") {
      await apply(config, options);
    } else if (command === "generate") {
      await generate(config, options);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error("Failed to apply configuration:", error);
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

const mainCommand = defineCommand({
  meta: {
    name: "tailor-exec",
    description: "Tailor SDK execution CLI",
  },
  subCommands: {
    apply: applyCommand,
    generate: generateCommand,
  },
});

runMain(mainCommand);
