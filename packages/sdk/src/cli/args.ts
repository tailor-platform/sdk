import * as path from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import { isCLIError } from "./utils/errors";
import { logger } from "./utils/logger";
import type { ParsedArgs } from "citty";

// ============================================================================
// Validators
// ============================================================================

/**
 * Check if a string is a valid UUID
 */
export function isUUID(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

/**
 * Schema for workspace ID validation (UUID format)
 */
export const workspaceIdSchema = z.uuid({
  message: "workspace-id must be a valid UUID",
});

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
export const durationSchema = z
  .templateLiteral([z.number().int().positive(), z.enum(durationUnits)])
  .transform((duration) => {
    const match = duration.match(/^(\d+)(ms|s|m)$/)!;
    const value = parseInt(match[1], 10);
    const unit = match[2] as DurationUnit;
    return value * unitToMs[unit];
  });

/**
 * Parse a duration string (e.g., "3s", "500ms", "1m") to milliseconds
 */
export function parseDuration(duration: string): number {
  return durationSchema.parse(duration);
}

// ============================================================================
// Argument Definitions
// ============================================================================

/**
 * Common arguments for all CLI commands
 */
export const commonArgs = {
  "env-file": {
    type: "string",
    description: "Path to the environment file",
    alias: "e",
  },
  verbose: {
    type: "boolean",
    description: "Enable verbose logging",
    alias: "v",
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
 */
export const withCommonArgs =
  <T extends ParsedArgs<typeof commonArgs>>(
    handler: (args: T) => Promise<void>,
  ) =>
  async ({ args }: { args: T }) => {
    try {
      // Set JSON mode if --json flag is provided
      if ("json" in args && typeof args.json === "boolean") {
        logger.jsonMode = args.json;
      }
      if (args["env-file"] !== undefined) {
        const envPath = path.resolve(process.cwd(), args["env-file"]);
        loadEnvFile(envPath);
      }
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
