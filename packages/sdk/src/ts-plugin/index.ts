/**
 * TypeScript Language Service Plugin for Tailor Platform SDK.
 *
 * Automatically generates `tailor-env.d.ts` to provide type-safe
 * namespace definitions for `getDB()` without manual code generation.
 *
 * Usage in tsconfig.json:
 * ```json
 * {
 *   "compilerOptions": {
 *     "plugins": [
 *       {
 *         "name": "@tailor-platform/sdk/ts-plugin",
 *         "configPath": "./tailor.config.ts",
 *         "outputPath": "./tailor-env.d.ts"
 *       }
 *     ]
 *   }
 * }
 * ```
 */

import { execSync } from "node:child_process";
import { existsSync, writeFileSync, watch } from "node:fs";
import * as path from "node:path";
import { generateDts } from "./generator";
import type { Manifest } from "@/cli/generator/manifest";

type PluginConfig = {
  configPath?: string;
  outputPath?: string;
};

/**
 * TS Language Service Plugin create info (minimal subset).
 * Avoids importing the `typescript` module directly since the TS server
 * provides it at runtime via the `modules` parameter.
 */
type PluginCreateInfo = {
  project: {
    projectService: {
      logger: { info: (s: string) => void };
    };
    getCurrentDirectory: () => string;
  };
  config: Record<string, unknown>;
  languageService: unknown;
};

/**
 * @returns TS Language Service Plugin module with a create function
 */
function init() {
  function create(info: PluginCreateInfo) {
    const logger = info.project.projectService.logger;
    const projectDir = info.project.getCurrentDirectory();
    const pluginConfig = (info.config ?? {}) as PluginConfig;

    const configPath = pluginConfig.configPath
      ? path.resolve(projectDir, pluginConfig.configPath)
      : path.resolve(projectDir, "tailor.config.ts");

    const outputPath = pluginConfig.outputPath
      ? path.resolve(projectDir, pluginConfig.outputPath)
      : path.resolve(projectDir, "tailor-env.d.ts");

    const outputDir = path.dirname(outputPath);

    function log(message: string): void {
      logger.info(`[tailor-sdk] ${message}`);
    }

    /**
     * Find the tailor-sdk binary in the project's node_modules.
     * @returns Absolute path to the binary, or undefined if not found
     */
    function findSdkBin(): string | undefined {
      const binPath = path.resolve(projectDir, "node_modules", ".bin", "tailor-sdk");
      if (existsSync(binPath)) return binPath;
      return undefined;
    }

    /**
     * Extract manifest by invoking the CLI as a child process.
     * @returns Parsed manifest, or undefined on failure
     */
    function extractManifest(): Manifest | undefined {
      const sdkBin = findSdkBin();
      if (!sdkBin) {
        log("tailor-sdk binary not found in node_modules/.bin");
        return undefined;
      }

      try {
        const result = execSync(`"${sdkBin}" manifest --config "${configPath}"`, {
          cwd: projectDir,
          encoding: "utf-8",
          timeout: 30_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return JSON.parse(result) as Manifest;
      } catch (error) {
        log(`Failed to extract manifest: ${String(error)}`);
        return undefined;
      }
    }

    /**
     * Regenerate tailor-env.d.ts from the current config.
     */
    function regenerate(): void {
      const manifest = extractManifest();
      if (!manifest) return;

      const content = generateDts(manifest, outputDir);
      try {
        writeFileSync(outputPath, content, "utf-8");
        log(`Generated ${outputPath}`);
      } catch (error) {
        log(`Failed to write ${outputPath}: ${String(error)}`);
      }
    }

    // Initial generation
    if (existsSync(configPath)) {
      log(`Config found at ${configPath}, generating types...`);
      regenerate();
    } else {
      log(`Config not found at ${configPath}, skipping generation`);
    }

    // Watch for model file changes using fs.watch (recursive)
    const configDir = path.dirname(configPath);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    function debouncedRegenerate(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        log("Model files changed, regenerating...");
        regenerate();
      }, 500);
    }

    try {
      watch(configDir, { recursive: true }, (_event, filename) => {
        if (filename && filename.endsWith(".ts") && !filename.endsWith(".d.ts")) {
          debouncedRegenerate();
        }
      });
      log(`Watching ${configDir} for changes`);
    } catch (error) {
      log(`Failed to set up file watcher: ${String(error)}`);
    }

    // Return the original language service unmodified
    return info.languageService;
  }

  return { create };
}

export default init;
