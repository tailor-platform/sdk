#!/usr/bin/env node

import { existsSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findUpSync } from "find-up-simple";

const __dirname = import.meta.dirname;
const DEFAULT_CONFIG_FILENAME = "tailor.config.ts";

async function install() {
  const cwd = process.env.INIT_CWD || process.cwd();

  // Skip if running in the tailor-sdk package itself
  if (cwd === __dirname || cwd === resolve(__dirname, "..", "..")) {
    console.log("⚠️  Skipping postinstall in tailor-sdk package itself");
    return;
  }

  console.log("🔧 Initializing Tailor Platform SDK type definitions...");

  // Try to find and load the user's tailor.config.ts
  // Priority: env/config > search parent directories
  const configPath = process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH
    ? resolve(cwd, process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH)
    : findUpSync(DEFAULT_CONFIG_FILENAME, { cwd });

  if (!configPath || !existsSync(configPath)) {
    console.log("⚠️  No tailor.config.ts found, skipping type generation");
    return;
  }

  try {
    const registerHooks = nodeModule.registerHooks;
    if (registerHooks) {
      const { resolveSync, loadSync } = await import("./dist/cli/ts-hook.mjs");
      registerHooks({ resolve: resolveSync, load: loadSync });
    } else {
      nodeModule.register(new URL("./dist/cli/ts-hook.mjs", import.meta.url), import.meta.url);
    }
    const configDir = dirname(configPath);
    process.chdir(configDir);

    const { generateUserTypes, loadConfig } = await import(
      pathToFileURL(resolve(__dirname, "dist", "cli", "lib.mjs")).href
    );
    const { config } = await loadConfig(configPath);
    await generateUserTypes({ config, configPath });
  } catch (error) {
    console.warn("⚠️  Failed to generate types from config:", error.message);
  }
}

// Only run if this is the main module
if (import.meta.url === new URL(import.meta.url).href) {
  install();
}
