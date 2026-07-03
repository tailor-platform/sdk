import * as fs from "node:fs";
import { parseEnv } from "node:util";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { assertDefined } from "#/utils/assert";
import { logger } from "./logger";

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
      const match = val.match(durationPattern);
      if (!match) return false;
      const digits = match[1];
      return digits !== undefined && parseInt(digits, 10) > 0;
    },
    { message: "Duration must be greater than 0" },
  );

/**
 * Parse a validated duration string into milliseconds
 * @param duration - Duration string (e.g., "3s", "500ms", "1m")
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  const match = assertDefined(
    duration.match(durationPattern),
    `invalid duration format: ${duration}`,
  );
  const value = parseInt(assertDefined(match[1], "duration digits group missing"), 10);
  const unit = assertDefined(match[2], "duration unit group missing") as DurationUnit;
  return value * unitToMs[unit];
}

/**
 * Schema for positive integer validation (from string input)
 * Transforms the string to a number
 */
export const positiveIntArg = z.coerce.number().int().positive();

/**
 * Schema for non-negative integer validation (from string input).
 * Accepts 0 (used for `--limit 0` to disable the limit).
 */
export const nonNegativeIntArg = z.coerce.number().int().nonnegative();

/**
 * Schema for sort order (`asc` or `desc`).
 */
export const orderArg = z.enum(["asc", "desc"]);

export type Order = z.infer<typeof orderArg>;

/**
 * Translate a CLI `--order` value into the proto `PageDirection` enum.
 * Returns `undefined` when the user did not specify an order so that
 * callers can omit the field and fall back to the server default.
 * @param order - Order string from CLI args (`"asc"` | `"desc"` | undefined)
 * @returns PageDirection, or undefined when `order` is undefined
 */
export function toPageDirection(order: Order | undefined): PageDirection | undefined {
  if (order === undefined) return undefined;
  return order === "asc" ? PageDirection.ASC : PageDirection.DESC;
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
    completion: { type: "file", matcher: [".env.*", ".env"] },
  }),
  "env-file-if-exists": arg(z.string().optional(), {
    description: "Path to the environment file (ignored if not found)",
    completion: { type: "file", matcher: [".env.*", ".env"] },
    effect: (_value, { args }) => {
      loadEnvFiles(
        args["env-file"] as string | undefined,
        args["env-file-if-exists"] as string | undefined,
      );
    },
  }),
  verbose: arg(z.boolean().default(false), {
    description: "Enable verbose logging",
    effect: (value) => {
      verboseMode = value;
    },
  }),
  json: arg(z.boolean().default(false), {
    alias: "j",
    description: "Output as JSON",
    effect: (value) => {
      logger.jsonMode = value;
    },
  }),
} satisfies ArgsShape;

/**
 * Arguments for commands that require workspace context
 */
export const workspaceArgs = {
  "workspace-id": arg(z.string().optional(), {
    alias: "w",
    description: "Workspace ID",
    env: "TAILOR_PLATFORM_WORKSPACE_ID",
    completion: { type: "none" },
  }),
  profile: arg(z.string().optional(), {
    alias: "p",
    description: "Workspace profile",
    env: "TAILOR_PLATFORM_PROFILE",
    completion: { type: "none" },
  }),
} satisfies ArgsShape;

/**
 * Shared config arg for commands that accept a config file path
 */
export const configArg = {
  config: arg(z.string().default("tailor.config.ts"), {
    alias: "c",
    description: "Path to SDK config file",
    env: "TAILOR_PLATFORM_SDK_CONFIG_PATH",
    completion: { type: "file", extensions: ["ts"] },
  }),
} satisfies ArgsShape;

/**
 * Shared config arg for commands that accept one or more comma-separated config file paths
 */
export const multiConfigArg = {
  config: arg(z.string().default("tailor.config.ts"), {
    alias: "c",
    description:
      "Path to SDK config file. Use comma-separated paths to deploy multiple apps together.",
    env: "TAILOR_PLATFORM_SDK_CONFIG_PATH",
    completion: { type: "file", extensions: ["ts"] },
  }),
} satisfies ArgsShape;

/**
 * Arguments for commands that interact with deployed resources (includes config)
 */
export const deploymentArgs = {
  ...workspaceArgs,
  ...configArg,
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
 * Arguments for commands that require organization context
 */
export const organizationArgs = {
  "organization-id": arg(z.string(), {
    alias: "o",
    description: "Organization ID",
    env: "TAILOR_PLATFORM_ORGANIZATION_ID",
    completion: { type: "none" },
  }),
} satisfies ArgsShape;

/**
 * Arguments for list commands that accept `--order` / `--limit`. Sort
 * order defaults to `desc` (newest first) because most callers want the
 * latest items; pass `--order asc` to opt in to ascending order. The
 * limit is unbounded by default so existing invocations keep returning
 * every item; pass `--limit N` to cap the result size.
 * @param defaultOrder - Default value for `--order` (defaults to `"desc"`)
 * @returns Argument shape suitable for spreading into a command schema
 */
export const paginationArgs = (defaultOrder: Order = "desc") =>
  ({
    order: arg(orderArg.default(defaultOrder), {
      description: "Sort order (asc or desc)",
    }),
    limit: arg(nonNegativeIntArg.optional(), {
      alias: "l",
      description: "Maximum number of items to return (0 or omit: unlimited)",
    }),
  }) satisfies ArgsShape;

/**
 * Arguments for time-series log list commands. Defaults to newest-first
 * (`desc`) and a 50-item cap so that listing stays responsive on busy
 * workspaces. Pass `--limit 0` to disable the cap and fetch all entries.
 */
export const pagedLogArgs = {
  order: arg(orderArg.default("desc"), {
    description: "Sort order (asc or desc)",
  }),
  limit: arg(nonNegativeIntArg.default(50), {
    alias: "l",
    description: "Maximum number of items to return (0: unlimited)",
  }),
} satisfies ArgsShape;

/**
 * Arguments for commands that require folder context
 */
export const folderArgs = {
  "folder-id": arg(z.string(), {
    alias: "f",
    description: "Folder ID",
    env: "TAILOR_PLATFORM_FOLDER_ID",
    completion: { type: "none" },
  }),
} satisfies ArgsShape;

export type CommonArgsType = z.infer<z.ZodObject<typeof commonArgs>>;

// Tracks verbose mode for use in global error handler (cleanup)
let verboseMode = false;

/**
 * Returns whether verbose mode is enabled.
 * Used by the global cleanup handler which doesn't have access to parsed args.
 * @returns Whether verbose mode is enabled
 */
export function isVerbose(): boolean {
  return verboseMode;
}
