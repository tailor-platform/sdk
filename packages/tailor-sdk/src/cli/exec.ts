#!/usr/bin/env tsx

import url from "node:url";
import path from "node:path";
import type { WorkspaceConfig } from "../config";
import { apply, generate } from "../workspace";

const __filename = url.fileURLToPath(import.meta.url);

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

async function main() {
  try {
    const command = process.argv[2];
    const configPath = process.argv[3] || "tailor.config.ts";

    if (!command || (command !== "apply" && command !== "generate")) {
      console.error("Error: Command must be 'apply' or 'generate'");
      console.error("Usage: tsx exec.ts <apply|generate> [config-path]");
      process.exit(1);
    }

    const config = await loadConfig(configPath);

    if (command === "apply") {
      await apply(config);
      console.log("Configuration applied successfully.");
    } else if (command === "generate") {
      await generate(config);
      console.log("Files generated successfully.");
    }
  } catch (error) {
    console.error(`Failed to ${process.argv[2]} configuration:`, error);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main().catch(console.error);
}
