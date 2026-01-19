import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML, stringifyYAML, parseTOML } from "confbox";
import { findUpSync } from "find-up-simple";
import ml from "multiline-ts";
import * as path from "pathe";
import { xdgConfig } from "xdg-basedir";
import { z } from "zod";
import { initOAuth2Client } from "./client";
import { logger } from "./utils/logger";

const pfConfigSchema = z.object({
  version: z.literal(1),
  users: z.partialRecord(
    z.string(),
    z.object({
      access_token: z.string(),
      refresh_token: z.string(),
      token_expires_at: z.string(),
    }),
  ),
  profiles: z.partialRecord(
    z.string(),
    z.object({
      user: z.string(),
      workspace_id: z.string(),
    }),
  ),
  // null if no user is currently selected
  current_user: z.string().nullable(),
});

type PfConfig = z.output<typeof pfConfigSchema>;

function platformConfigPath() {
  if (!xdgConfig) {
    throw new Error("User home directory not found");
  }
  return path.join(xdgConfig, "tailor-platform", "config.yaml");
}

/**
 * Read Tailor Platform CLI configuration, migrating from tailorctl if necessary.
 * @returns {PfConfig} Parsed platform configuration
 */
export function readPlatformConfig(): PfConfig {
  const configPath = platformConfigPath();

  // If platform config doesn't exist, try to read tailorctl config and migrate
  if (!fs.existsSync(configPath)) {
    logger.warn(`Config not found at ${configPath}, migrating from tailorctl config...`);
    const tcConfig = readTailorctlConfig();
    const pfConfig = tcConfig
      ? fromTailorctlConfig(tcConfig)
      : ({ version: 1, users: {}, profiles: {}, current_user: null } as const);
    writePlatformConfig(pfConfig);
    return pfConfig;
  }
  const rawConfig = parseYAML(fs.readFileSync(configPath, "utf-8"));
  return pfConfigSchema.parse(rawConfig);
}

/**
 * Write Tailor Platform CLI configuration to disk.
 * @param {PfConfig} config - Platform configuration to write
 * @returns {void}
 */
export function writePlatformConfig(config: PfConfig) {
  const configPath = platformConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, stringifyYAML(config));
}

const tcContextConfigSchema = z.object({
  username: z.string().optional(),
  controlplaneaccesstoken: z.string().optional(),
  controlplanerefreshtoken: z.string().optional(),
  controlplanetokenexpiresat: z.string().optional(),
  workspaceid: z.string().optional(),
});

const tcConfigSchema = z
  .object({
    global: z
      .object({
        context: z.string().optional(),
      })
      .optional(),
  })
  .catchall(tcContextConfigSchema.optional());

type TcConfig = z.output<typeof tcConfigSchema>;
type TcContextConfig = z.output<typeof tcContextConfigSchema>;

function readTailorctlConfig(): TcConfig | undefined {
  const configPath = path.join(os.homedir(), ".tailorctl", "config");
  if (!fs.existsSync(configPath)) {
    return;
  }
  const rawConfig = parseTOML(fs.readFileSync(configPath, "utf-8"));
  return tcConfigSchema.parse(rawConfig);
}

function fromTailorctlConfig(config: TcConfig): PfConfig {
  const users: PfConfig["users"] = {};
  const profiles: PfConfig["profiles"] = {};
  let currentUser: PfConfig["current_user"] = null;

  const currentContext = config.global?.context || "default";
  for (const [key, val] of Object.entries(config)) {
    if (key === "global") {
      continue;
    }
    const context = val as TcContextConfig;
    if (
      !context.username ||
      !context.controlplaneaccesstoken ||
      !context.controlplanerefreshtoken ||
      !context.controlplanetokenexpiresat ||
      !context.workspaceid
    ) {
      continue;
    }
    if (key === currentContext) {
      currentUser = context.username;
    }
    profiles[key] = {
      user: context.username,
      workspace_id: context.workspaceid,
    };
    const user = users[context.username];
    if (!user || new Date(user.token_expires_at) < new Date(context.controlplanetokenexpiresat)) {
      users[context.username] = {
        access_token: context.controlplaneaccesstoken,
        refresh_token: context.controlplanerefreshtoken,
        token_expires_at: context.controlplanetokenexpiresat,
      };
    }
  }
  return { version: 1, users, profiles, current_user: currentUser };
}

function validateUUID(value: string, source: string): string {
  const result = z.uuid().safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid value from ${source}: must be a valid UUID`);
  }
  return result.data;
}

/**
 * Load workspace ID from command options, environment variables, or platform config.
 * Priority: opts/workspaceId > env/workspaceId > opts/profile > env/profile > error
 * @param {{ workspaceId?: string; profile?: string }} [opts] - Workspace and profile options
 * @param {string} [opts.workspaceId] - Workspace ID
 * @param {string} [opts.profile] - Workspace profile name
 * @returns {string} Resolved workspace ID
 */
export function loadWorkspaceId(opts?: { workspaceId?: string; profile?: string }): string {
  // opts/workspaceId
  if (opts?.workspaceId) {
    return validateUUID(opts.workspaceId, "--workspace-id option");
  }

  // env/workspaceId
  if (process.env.TAILOR_PLATFORM_WORKSPACE_ID) {
    return validateUUID(
      process.env.TAILOR_PLATFORM_WORKSPACE_ID,
      "TAILOR_PLATFORM_WORKSPACE_ID environment variable",
    );
  }

  // opts/profile > env/profile
  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
  if (profile) {
    const pfConfig = readPlatformConfig();
    const wsId = pfConfig.profiles[profile]?.workspace_id;
    if (!wsId) {
      throw new Error(`Profile "${profile}" not found`);
    }
    return validateUUID(wsId, `profile "${profile}"`);
  }

  // error
  throw new Error(ml`
    Workspace ID not found.
    Please specify workspace ID via --workspace-id option or TAILOR_PLATFORM_WORKSPACE_ID environment variable.
  `);
}

/**
 * Load access token from command options, environment variables, or platform config.
 * Priority: env/TAILOR_PLATFORM_TOKEN > env/TAILOR_TOKEN (deprecated) > opts/profile > env/profile > config/currentUser > error
 * @param {{ useProfile?: boolean; profile?: string }} [opts] - Profile options
 * @param {boolean} [opts.useProfile] - Whether to use profile resolution
 * @param {string} [opts.profile] - Profile name
 * @returns {Promise<string>} Resolved access token
 */
export async function loadAccessToken(opts?: { useProfile?: boolean; profile?: string }) {
  // env/pat - TAILOR_PLATFORM_TOKEN takes precedence
  if (process.env.TAILOR_PLATFORM_TOKEN) {
    return process.env.TAILOR_PLATFORM_TOKEN;
  }
  // TAILOR_TOKEN is deprecated
  if (process.env.TAILOR_TOKEN) {
    logger.warn("TAILOR_TOKEN is deprecated. Please use TAILOR_PLATFORM_TOKEN instead.");
    return process.env.TAILOR_TOKEN;
  }

  const pfConfig = readPlatformConfig();
  let user;
  // opts/profile > env/profile
  const profile = opts?.useProfile
    ? opts.profile || process.env.TAILOR_PLATFORM_PROFILE
    : undefined;
  if (profile) {
    const u = pfConfig.profiles[profile]?.user;
    if (!u) {
      throw new Error(`Profile "${profile}" not found`);
    }
    user = u;
  } else {
    // config/currentUser
    const u = pfConfig.current_user;
    if (!u) {
      // error
      throw new Error(ml`
        Tailor Platform token not found.
        Please specify token via TAILOR_PLATFORM_TOKEN environment variable or login using 'tailor-sdk login' command.
      `);
    }
    user = u;
  }

  return await fetchLatestToken(pfConfig, user);
}

/**
 * Fetch the latest access token, refreshing if necessary.
 * @param {PfConfig} config - Platform config
 * @param {string} user - User name
 * @returns {Promise<string>} Latest access token
 */
export async function fetchLatestToken(config: PfConfig, user: string): Promise<string> {
  const tokens = config.users[user];
  if (!tokens) {
    throw new Error(ml`
      User "${user}" not found.
      Please verify your user name and login using 'tailor-sdk login' command.
    `);
  }
  if (new Date(tokens.token_expires_at) > new Date()) {
    return tokens.access_token;
  }

  const client = initOAuth2Client();
  let resp;
  try {
    resp = await client.refreshToken({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.parse(tokens.token_expires_at),
    });
  } catch {
    throw new Error(ml`
      Failed to refresh token. Your session may have expired.
      Please run 'tailor-sdk login' and try again.
    `);
  }
  config.users[user] = {
    access_token: resp.accessToken,
    refresh_token: resp.refreshToken!,
    token_expires_at: new Date(resp.expiresAt!).toISOString(),
  };
  writePlatformConfig(config);
  return resp.accessToken;
}

const DEFAULT_CONFIG_FILENAME = "tailor.config.ts";

/**
 * Load config path from command options or environment variables.
 * Priority: opts/config > env/config > search parent directories
 * @param {string} [configPath] - Optional explicit config path
 * @returns {string | undefined} Resolved config path or undefined
 */
export function loadConfigPath(configPath?: string): string | undefined {
  if (configPath) {
    return configPath;
  }
  if (process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH) {
    return process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
  }

  // Search for config file in current directory and parent directories
  return findUpSync(DEFAULT_CONFIG_FILENAME);
}

/**
 * Load organization ID from command options or environment variables.
 * Priority: opts/organizationId > env/organizationId > undefined (optional)
 * @param {string} [organizationId] - Organization ID override
 * @returns {string | undefined} Resolved organization ID or undefined
 */
export function loadOrganizationId(organizationId?: string): string | undefined {
  if (organizationId) {
    return validateUUID(organizationId, "--organization-id option");
  }
  if (process.env.TAILOR_PLATFORM_ORGANIZATION_ID) {
    return validateUUID(
      process.env.TAILOR_PLATFORM_ORGANIZATION_ID,
      "TAILOR_PLATFORM_ORGANIZATION_ID environment variable",
    );
  }
  return undefined;
}

/**
 * Load folder ID from command options or environment variables.
 * Priority: opts/folderId > env/folderId > undefined (optional)
 * @param {string} [folderId] - Folder ID override
 * @returns {string | undefined} Resolved folder ID or undefined
 */
export function loadFolderId(folderId?: string): string | undefined {
  if (folderId) {
    return validateUUID(folderId, "--folder-id option");
  }
  if (process.env.TAILOR_PLATFORM_FOLDER_ID) {
    return validateUUID(
      process.env.TAILOR_PLATFORM_FOLDER_ID,
      "TAILOR_PLATFORM_FOLDER_ID environment variable",
    );
  }
  return undefined;
}
