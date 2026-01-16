import * as fs from "node:fs";
import * as path from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import { isCLIError } from "./utils/errors";
import { logger } from "./utils/logger";
import type { ParsedArgs } from "citty";

// ============================================================================
// Validators
// ============================================================================

const durationUnits = ["ms", "s", "m"] as const;
type DurationUnit = (typeof durationUnits)[number];

const unitToMs: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
};

/**
 * Schema for duration string validation (e.g., "3s", "500ms", "1m")
 * Transforms the string to milliseconds
 */
const durationSchema = z
  .templateLiteral([z.number().int().positive(), z.enum(durationUnits)])
  .transform((duration) => {
    const match = duration.match(/^(\d+)(ms|s|m)$/)!;
    const value = parseInt(match[1], 10);
    const unit = match[2] as DurationUnit;
    return value * unitToMs[unit];
  });

/**
 * Parse a duration string (e.g., "3s", "500ms", "1m") to milliseconds
 * @param {string} duration - Duration string with unit suffix (ms, s, m)
 * @returns {number} Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  return durationSchema.parse(duration);
}

// ============================================================================
// Env File Helpers
// ============================================================================

type EnvFileArg = string | string[] | undefined;

/**
 * Load env files from parsed arguments.
 * Processes --env-file first, then --env-file-if-exists.
 *
 * Follows Node.js --env-file behavior:
 * - Variables already set in the environment are NOT overwritten
 * - Variables from later files override those from earlier files
 * @param {EnvFileArg} envFiles - Required env file path(s) that must exist
 * @param {EnvFileArg} envFilesIfExists - Optional env file path(s) that are loaded if they exist
 */
export function loadEnvFiles(envFiles: EnvFileArg, envFilesIfExists: EnvFileArg): void {
  // Snapshot of originally set environment variables (before loading any files)
  const originalEnvKeys = new Set(Object.keys(process.env));

  const load = (files: EnvFileArg, required: boolean) => {
    for (const file of [files ?? []].flat()) {
      const envPath = path.resolve(process.cwd(), file);
      if (!fs.existsSync(envPath)) {
        if (required) {
          throw new Error(`Environment file not found: ${envPath}`);
        }
        continue;
      }
      const content = fs.readFileSync(envPath, "utf-8");
      const parsed = parseEnv(content);
      for (const [key, value] of Object.entries(parsed)) {
        // Skip if the variable was originally set in the environment
        if (originalEnvKeys.has(key)) {
          continue;
        }
        // Allow overwriting between env files
        process.env[key] = value;
      }
    }
  };

  load(envFiles, true);
  load(envFilesIfExists, false);
}

// ============================================================================
// Argument Definitions
// ============================================================================

/**
 * Common arguments for all CLI commands
 *
 * NOTE: --env-file and --env-file-if-exists collide with Node.js flags due to a bug
 * (https://github.com/nodejs/node/issues/54232). Node.js parses these even after the
 * script path, causing warnings (twice due to tsx loader).
 */
export const commonArgs = {
  "env-file": {
    type: "string",
    description: "Path to the environment file (error if not found)",
    alias: "e",
  },
  "env-file-if-exists": {
    type: "string",
    description: "Path to the environment file (ignored if not found)",
  },
  verbose: {
    type: "boolean",
    description: "Enable verbose logging",
    default: false,
  },
} as const;

/**
 * Arguments for commands that require workspace context
 */
export const workspaceArgs = {
  "workspace-id": {
    type: "string",
    description: "Workspace ID",
    alias: "w",
  },
  profile: {
    type: "string",
    description: "Workspace profile",
    alias: "p",
  },
} as const;

/**
 * Arguments for commands that interact with deployed resources (includes config)
 */
export const deploymentArgs = {
  ...workspaceArgs,
  config: {
    type: "string",
    description: "Path to SDK config file",
    alias: "c",
    default: "tailor.config.ts",
  },
} as const;

/**
 * Arguments for commands that require confirmation
 */
export const confirmationArgs = {
  yes: {
    type: "boolean",
    description: "Skip confirmation prompts",
    alias: "y",
    default: false,
  },
} as const;

/**
 * Arguments for JSON output
 */
export const jsonArgs = {
  json: {
    type: "boolean",
    description: "Output as JSON",
    alias: "j",
    default: false,
  },
} as const;

/**
 * Wrapper for command handlers that provides:
 * - Environment file loading
 * - Error handling with formatted output
 * - Exit code management
 * @template T
 * @param {(args: T) => Promise<void>} handler - Command handler function
 * @returns {(ctx: { args: T }) => Promise<void>} Wrapped handler
 */
export const withCommonArgs =
  <T extends ParsedArgs<typeof commonArgs>>(handler: (args: T) => Promise<void>) =>
  async ({ args }: { args: T }) => {
    try {
      // Set JSON mode if --json flag is provided
      if ("json" in args && typeof args.json === "boolean") {
        logger.jsonMode = args.json;
      }

      // Load env files
      loadEnvFiles(args["env-file"] as EnvFileArg, args["env-file-if-exists"] as EnvFileArg);

      await handler(args);
    } catch (error) {
      if (isCLIError(error)) {
        logger.log(error.format());
        if (args.verbose && error.stack) {
          logger.debug(`\nStack trace:\n${error.stack}`);
        }
      } else if (error instanceof Error) {
        logger.error(error.message);
        if (args.verbose && error.stack) {
          logger.debug(`\nStack trace:\n${error.stack}`);
        }
      } else {
        logger.error(`Unknown error: ${error}`);
      }
      process.exit(1);
    }
    process.exit(0);
  };
