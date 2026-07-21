import * as fs from "node:fs";
import { parseEnv } from "node:util";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { logger } from "./logger";

type ArgsShape = Record<string, z.ZodType>;

type EnvFileArg = string | string[] | undefined;

/**
 * Load env files from parsed arguments, following Node.js --env-file behavior:
 * variables already set in the environment are not overwritten, and variables
 * from later files override those from earlier files.
 * @param envFiles - Required env file path(s) that must exist
 * @param envFilesIfExists - Optional env file path(s) that are loaded if they exist
 */
function loadEnvFiles(envFiles: EnvFileArg, envFilesIfExists: EnvFileArg): void {
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
        if (originalEnvKeys.has(key)) {
          continue;
        }
        process.env[key] = value;
      }
    }
  };

  load(envFiles, true);
  load(envFilesIfExists, false);
}

/**
 * Common arguments shared with the host Tailor CLI so that forwarded global
 * flags parse identically when dispatched as a plugin.
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
    // -v matches the generated seed runner this plugin replaces.
    alias: "v",
    description: "Enable verbose logging",
    effect: (value) => {
      logger.verbose = value;
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
    description: "Path to Tailor config file",
    env: "TAILOR_CONFIG_PATH",
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

export type CommonArgsType = z.infer<z.ZodObject<typeof commonArgs>>;
