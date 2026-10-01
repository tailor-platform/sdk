import * as fs from "node:fs";
import { parseEnv } from "node:util";
import { arg, parseArgv } from "@politty/zod";
import { PageDirection } from "@tailor-platform/tailor-proto/resource_pb";
import * as path from "pathe";
import { z } from "zod";
import { assertDefined } from "#/utils/assert";
import { withErrorDiagnostics } from "./error-diagnostics";
import { JSON_OUTPUT_ENV_VAR, logger, type JsonModeSource } from "./logger";
import { parseBoolean } from "./parse-boolean";

type ArgsShape = Record<string, z.ZodType>;
export type MachineUserInputSource = "option" | "env";
type ResolveMachineUserInputSourceOptions = {
  valueIsExplicit?: boolean;
};

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

/**
 * Drop the arguments after `--`, which belong to the invoked program.
 * @param argv - Raw CLI argv, excluding the executable and script path
 * @returns The tokens the CLI itself parses as options
 */
function optionTokens(argv: readonly string[]): readonly string[] {
  const separator = argv.indexOf("--");
  return separator === -1 ? argv : argv.slice(0, separator);
}

function hasMachineUserFlag(argv: readonly string[]): boolean {
  return optionTokens(argv).some(
    (token) =>
      token === "-m" ||
      token.startsWith("-m=") ||
      token === "--machine-user" ||
      token.startsWith("--machine-user=") ||
      token === "--machineUser" ||
      token.startsWith("--machineUser=") ||
      token === "--machineuser" ||
      token.startsWith("--machineuser="),
  );
}

/**
 * Resolve whether a parsed machine user value came from an explicit CLI option or env fallback.
 * @param machineUser - Parsed machine user value
 * @param argv - Raw CLI argv, excluding the executable and script path
 * @param options - Source resolution options
 * @returns Machine user input source, or undefined when no value was parsed
 */
export function resolveMachineUserInputSource(
  machineUser: string | undefined,
  argv: readonly string[] = process.argv.slice(2),
  options: ResolveMachineUserInputSourceOptions = {},
): MachineUserInputSource | undefined {
  if (machineUser === undefined) return undefined;
  if (options.valueIsExplicit) return "option";
  if (hasMachineUserFlag(argv)) return "option";
  return process.env.TAILOR_PLATFORM_MACHINE_USER_NAME === machineUser ? "env" : "option";
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

/** Name and short alias of the `--json` flag. */
const JSON_ARG_NAME = "json";
const JSON_ARG_ALIAS = "j";
const VERBOSE_ARG_NAME = "verbose";

const GLOBAL_FLAG_PARSER_OPTIONS = {
  aliasMap: new Map([[JSON_ARG_ALIAS, JSON_ARG_NAME]]),
  booleanFlags: new Set([JSON_ARG_NAME, VERBOSE_ARG_NAME]),
};

let globalArgsWereApplied = false;

/**
 * Report whether the global arguments have been applied, which happens only
 * after every argument of the command parsed and validated.
 * @returns True once the `--json` effect has run
 */
export function globalArgsApplied(): boolean {
  return globalArgsWereApplied;
}

/**
 * Read the value tokens set for a global boolean flag, coerced the way the CLI
 * coerces the flag and its environment variable.
 * @param tokens - Tokens of the flag, each optionally carrying `=value`
 * @param name - Flag name
 * @returns `true`, `false`, a rejected value unchanged, or undefined when no token sets it
 */
function parseGlobalFlag(tokens: string[], name: string): unknown {
  return parseArgv(tokens, GLOBAL_FLAG_PARSER_OPTIONS).options[name];
}

/**
 * Read the value the command line gives a global boolean flag. Tokens after
 * `--` are positional values, never flags.
 * @param argv - Command-line arguments after the executable and script path
 * @param name - Flag name
 * @param alias - Short alias of the flag, if it has one
 * @returns `true`, `false`, a rejected value unchanged, or undefined when argv does not set it
 */
function globalFlagValue(argv: readonly string[], name: string, alias?: string): unknown {
  const separator = argv.indexOf("--");
  const options = separator === -1 ? argv : argv.slice(0, separator);
  return parseGlobalFlag(
    options.filter((value) => {
      const [token] = value.split("=", 1);
      return token === `--${name}` || (alias !== undefined && token === `-${alias}`);
    }),
    name,
  );
}

/**
 * Report whether the command line turns `--json` on.
 *
 * A failure during argument parsing or validation ends the command before the
 * `--json` effect sets the logger's mode, so the flag is read from argv instead.
 * @param argv - Command-line arguments after the executable and script path
 * @returns True when argv sets `--json` or `-j` to true
 */
export function jsonFlagRequested(argv: readonly string[]): boolean {
  return globalFlagValue(argv, JSON_ARG_NAME, JSON_ARG_ALIAS) === true;
}

/**
 * Report what requested JSON output, reading the command line and the environment
 * the same way the `--json` effect would.
 * @param argv - Command-line arguments after the executable and script path
 * @returns What requested JSON output, or undefined when it is off
 */
export function requestedJsonModeSource(argv: readonly string[]): JsonModeSource | undefined {
  const flag = globalFlagValue(argv, JSON_ARG_NAME, JSON_ARG_ALIAS);
  const env = process.env[JSON_OUTPUT_ENV_VAR];
  const envEnabled =
    env !== undefined && parseGlobalFlag([`--${JSON_ARG_NAME}=${env}`], JSON_ARG_NAME) === true;
  if (flag === true) return envEnabled ? "both" : "flag";
  if (flag === undefined && envEnabled) return "env";
  return undefined;
}

/**
 * Prepare a failure that ended the command before the global arguments were
 * applied (see {@link globalArgsApplied}): apply `--verbose`, and when the
 * command line or the environment asked for JSON output, turn it on and name a
 * plain argument-parsing error `INVALID_ARGUMENTS`.
 * @param error - Failure about to be rendered
 * @param argv - Command-line arguments after the executable and script path
 */
export function resolveEarlyFailure(error: unknown, argv: readonly string[]): void {
  if (globalFlagValue(argv, VERBOSE_ARG_NAME) === true) logger.verbose = true;
  const source = requestedJsonModeSource(argv);
  if (!source) return;
  logger.setJsonMode(true, source);
  if (
    error instanceof Error &&
    Object.getPrototypeOf(error) === Error.prototype &&
    !Object.hasOwn(error, "code")
  ) {
    withErrorDiagnostics(error, { code: "INVALID_ARGUMENTS" });
  }
}

interface CommonArgsOptions {
  /** Extra short alias for `--verbose` (e.g. `"v"`), for plugins that need one */
  verboseAlias?: string;
}

/**
 * Build the common arguments for all CLI commands. CLI plugins call this so
 * their forwarded global flags parse identically to the host Tailor CLI and
 * feed the same logger state.
 *
 * NOTE: --env-file and --env-file-if-exists collide with Node.js flags due to a bug
 * (https://github.com/nodejs/node/issues/54232). Node.js parses these even after the
 * script path, causing warnings (twice due to tsx loader).
 * @param options - Per-plugin adjustments to the shared arguments
 * @returns Argument shape suitable for spreading into a command schema
 */
export function createCommonArgs(options: CommonArgsOptions = {}) {
  return {
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
    [VERBOSE_ARG_NAME]: arg(z.boolean().default(false), {
      ...(options.verboseAlias === undefined ? {} : { alias: options.verboseAlias }),
      description: "Enable verbose logging",
      effect: (value) => {
        logger.verbose = value;
      },
    }),
    [JSON_ARG_NAME]: arg(z.boolean().default(false), {
      alias: JSON_ARG_ALIAS,
      description: "Output as JSON",
      env: JSON_OUTPUT_ENV_VAR,
      effect: (value, { args }) => {
        globalArgsWereApplied = true;
        const source = args.$source?.(JSON_ARG_NAME);
        const envAlsoEnabled =
          source === "cli" && parseBoolean(process.env[JSON_OUTPUT_ENV_VAR]) === true;
        logger.setJsonMode(value, source === "env" ? "env" : envAlsoEnabled ? "both" : "flag");
      },
    }),
  } satisfies ArgsShape;
}

/**
 * Common arguments for all CLI commands
 */
export const commonArgs = createCommonArgs();

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
 * Default config file path used when --config is not passed
 */
export const DEFAULT_CONFIG_PATH = "tailor.config.ts";

/**
 * Format the --config argument for remediation command hints so they target
 * the same config the current run used. The `--config=<value>` form keeps a
 * leading-hyphen path bound as the option value.
 * @param {string} [configPath] - Config path the current run used, if any
 * @returns {string | undefined} `--config=<path>` argument, or undefined when the default config is in use
 */
export function formatConfigArg(configPath?: string): string | undefined {
  if (!configPath) return undefined;
  const relativeConfigPath = path.relative(process.cwd(), configPath);
  if (relativeConfigPath === DEFAULT_CONFIG_PATH) return undefined;
  return `--config=${relativeConfigPath}`;
}

/** Profile and workspace selection the current run used. */
export interface RecoveryContext {
  profile?: string | undefined;
  workspaceId?: string | undefined;
}

/**
 * Arguments that make a hinted follow-up command select the same profile and
 * workspace as the current run. The `--option=<value>` form keeps a
 * leading-hyphen value bound as the option value.
 * @param {RecoveryContext} context - Profile and workspace id the current run used
 * @returns {readonly string[]} Arguments to append to the hinted command
 */
export function recoveryContextArgs(context: RecoveryContext): readonly string[] {
  return [
    ...(context.workspaceId ? [`--workspace-id=${context.workspaceId}`] : []),
    ...(context.profile ? [`--profile=${context.profile}`] : []),
  ];
}

/**
 * Arguments for a hinted `tailor profile update` command. The profile name
 * comes first unless it starts with a hyphen, which only parses after `--`.
 * @param {string} profile - Profile to update
 * @param {readonly string[]} options - Options to set on the profile
 * @returns {readonly string[]} Arguments following the `tailor` executable
 */
export function profileUpdateArgs(profile: string, options: readonly string[]): readonly string[] {
  return profile.startsWith("-")
    ? ["profile", "update", ...options, "--", profile]
    : ["profile", "update", profile, ...options];
}

/**
 * Shared config arg for commands that accept a config file path
 */
export const configArg = {
  config: arg(z.string().default(DEFAULT_CONFIG_PATH), {
    alias: "c",
    description: "Path to Tailor config file",
    env: "TAILOR_CONFIG_PATH",
    completion: { type: "file", extensions: ["ts"] },
  }),
} satisfies ArgsShape;

/**
 * Shared config arg for commands that accept one or more comma-separated config file paths
 */
export const multiConfigArg = {
  config: arg(z.string().default(DEFAULT_CONFIG_PATH), {
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
