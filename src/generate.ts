import url from "node:url";
import path from "node:path";
import { generate } from "@tailor-platform/tailor-sdk";
import type { WorkspaceConfig } from "../packages/tailor-sdk/src/config";

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
    const configPath = process.argv[2] || "tailor.config.ts";
    const config = await loadConfig(configPath);
    await generate(config);
    console.log("Files generated successfully.");
  } catch (error) {
    console.error("Failed to generate files:", error);
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main().catch(console.error);
}
