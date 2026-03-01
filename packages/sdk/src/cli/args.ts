import * as fs from "node:fs";
import { parseEnv } from "node:util";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { isCLIError } from "./utils/errors";
import { logger } from "./utils/logger";

type ArgsShape = Record<string, z.ZodType>;

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

const durationPattern = /^(\d+)(ms|s|m)$/;

/**
 * Schema for duration string validation (e.g., "3s", "500ms", "1m")
 * Only validates format; use parseDuration() to convert to milliseconds
 */
export const durationArg = z
  .string()
  .refine((val) => durationPattern.test(val), {
    message: "Invalid duration format. Expected format: '3s', '500ms', '1m'",
  })
  .refine(
    (val) => {
      const match = val.match(durationPattern)!;
      return parseInt(match[1], 10) > 0;
    },
    { message: "Duration must be greater than 0" },
  );

/**
 * Parse a validated duration string into milliseconds
 * @param duration - Duration string (e.g., "3s", "500ms", "1m")
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.match(durationPattern)!;
  const value = parseInt(match[1], 10);
  const unit = match[2] as DurationUnit;
  return value * unitToMs[unit];
}

/**
 * Schema for positive integer validation (from string input)
 * Transforms the string to a number
 */
export const positiveIntArg = z.coerce.number().int().positive();

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
 * @param envFiles - Required env file path(s) that must exist
 * @param envFilesIfExists - Optional env file path(s) that are loaded if they exist
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
  "env-file": arg(z.string().optional(), {
    alias: "e",
    description: "Path to the environment file (error if not found)",
    completion: { type: "file" },
  }),
  "env-file-if-exists": arg(z.string().optional(), {
    description: "Path to the environment file (ignored if not found)",
    completion: { type: "file" },
  }),
  verbose: arg(z.boolean().default(false), {
    description: "Enable verbose logging",
  }),
} satisfies ArgsShape;

/**
 * Arguments for commands that require workspace context
 */
export const workspaceArgs = {
  "workspace-id": arg(z.string().optional(), {
    alias: "w",
    description: "Workspace ID",
    completion: { type: "none" },
  }),
  profile: arg(z.string().optional(), {
    alias: "p",
    description: "Workspace profile",
    completion: { type: "none" },
  }),
} satisfies ArgsShape;

/**
 * Arguments for commands that interact with deployed resources (includes config)
 */
export const deploymentArgs = {
  ...workspaceArgs,
  config: arg(z.string().default("tailor.config.ts"), {
    alias: "c",
    description: "Path to SDK config file",
    completion: { type: "file", extensions: ["ts"] },
  }),
} satisfies ArgsShape;

/**
 * Arguments for commands that require confirmation
 */
export const confirmationArgs = {
  yes: arg(z.boolean().default(false), {
    alias: "y",
    description: "Skip confirmation prompts",
  }),
} satisfies ArgsShape;

/**
 * Arguments for JSON output
 */
export const jsonArgs = {
  json: arg(z.boolean().default(false), {
    alias: "j",
    description: "Output as JSON",
  }),
} satisfies ArgsShape;

export type CommonArgsType = z.infer<z.ZodObject<typeof commonArgs>>;

/**
 * Wrapper for command handlers that provides:
 * - Environment file loading
 * - Error handling with formatted output
 * - Exit code management
 * @template T
 * @param handler - Command handler function
 * @returns Wrapped handler
 */
export const withCommonArgs =
  <T extends CommonArgsType>(handler: (args: T) => Promise<void>) =>
  async (args: T) => {
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
