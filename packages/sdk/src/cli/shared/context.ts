import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML, stringifyYAML, parseTOML } from "confbox";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { lt as semverLt } from "semver";
import { xdgConfig } from "xdg-basedir";
import { z } from "zod";
import { assertDefined } from "#/utils/assert";
import ml from "#/utils/multiline";
import {
  defaultPlatformBaseUrl,
  getConsoleBaseUrl,
  getPlatformBaseUrl,
  initOAuth2Client,
  normalizeBaseUrl,
  rememberPlatformConfigForToken,
  type PlatformClientConfig,
} from "./client";
import { CLIError } from "./errors";
import { logger } from "./logger";
import { readPackageJson } from "./package-json";
import { tightenSecretFilePermissions, writeSecretFile } from "./secret-file";
import {
  isKeyringAvailable,
  loadKeyringTokens,
  saveKeyringTokens,
  deleteKeyringTokens,
} from "./token-store";

const pfProfileSchema = z.object({
  user: z.string(),
  workspace_id: z.string(),
  readonly: z.boolean().optional(),
  machine_user: z.string().optional(),
  machine_user_override: z.enum(["allow", "deny"]).optional(),
  platform_url: z.url().optional(),
  oauth2_client_id: z.string().optional(),
  console_url: z.url().optional(),
});

const pfUserSchemaV1 = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  token_expires_at: z.string(),
});

const pfUserKeyringSchema = z.object({
  storage: z.literal("keyring"),
  token_expires_at: z.string(),
});

const pfUserFileSchema = z.object({
  storage: z.literal("file"),
  token_expires_at: z.string(),
  access_token: z.string(),
  refresh_token: z.string().optional(),
});

const pfUserSchemaV2 = z.discriminatedUnion("storage", [pfUserKeyringSchema, pfUserFileSchema]);

type PfUserV2 = z.output<typeof pfUserSchemaV2>;

const pfConfigSchemaV1 = z.object({
  version: z.literal(1),
  users: z.partialRecord(z.string(), pfUserSchemaV1),
  profiles: z.partialRecord(z.string(), pfProfileSchema),
  current_user: z.string().nullable(),
});

const LATEST_CONFIG_VERSION = 2;
const V2_MIN_SDK_VERSION = "1.29.0";

const semverSchema = z.templateLiteral([
  z.number().int(),
  ".",
  z.number().int(),
  ".",
  z.number().int(),
]);

const pfConfigSchemaV2 = z.object({
  version: z.literal(LATEST_CONFIG_VERSION),
  min_sdk_version: semverSchema,
  latest_version: z.number().int().optional(),
  latest_min_sdk_version: semverSchema.optional(),
  users: z.partialRecord(z.string(), pfUserSchemaV2),
  profiles: z.partialRecord(z.string(), pfProfileSchema),
  current_user: z.string().nullable(),
});

type PfConfigV1 = z.output<typeof pfConfigSchemaV1>;
type PfConfig = z.output<typeof pfConfigSchemaV2>;
type PfProfile = z.output<typeof pfProfileSchema>;
type LoadWorkspaceIdOptions = {
  workspaceId?: string;
  profile?: string;
};
type LoadAccessTokenOptions = {
  profile?: string;
};
type LoadPlatformClientConfigOptions = {
  profile?: string;
};
type LoadConsoleBaseUrlOptions = {
  profile?: string;
};
type LoadMachineUserNameOptions = {
  machineUser?: string;
  profile?: string;
};

function platformConfigPath() {
  if (!xdgConfig) {
    throw new Error("User home directory not found");
  }
  return path.join(xdgConfig, "tailor-platform", "config.yaml");
}

function platformConfigFromProfile(profile: PfProfile | undefined): PlatformClientConfig {
  return {
    ...(profile?.platform_url ? { platformUrl: profile.platform_url } : {}),
    ...(profile?.oauth2_client_id ? { oauth2ClientId: profile.oauth2_client_id } : {}),
    ...(profile?.console_url ? { consoleUrl: profile.console_url } : {}),
  };
}

function platformUserKey(user: string, config?: PlatformClientConfig): string {
  const platformUrl = getPlatformBaseUrl(config);
  if (platformUrl === normalizeBaseUrl(defaultPlatformBaseUrl)) {
    return user;
  }
  return `${platformUrl}|${user}`;
}

function canUseLegacyUserKey(platformUrl: string): boolean {
  return (
    process.env.PLATFORM_URL !== undefined &&
    normalizeBaseUrl(process.env.PLATFORM_URL) === platformUrl
  );
}

function findUserEntry(config: PfConfig, user: string, platformConfig?: PlatformClientConfig) {
  const userKey = platformUserKey(user, platformConfig);
  const userEntry = config.users[userKey];
  if (userEntry) {
    return { userKey, userEntry };
  }
  const platformUrl = getPlatformBaseUrl(platformConfig);
  if (userKey !== user && !canUseLegacyUserKey(platformUrl)) {
    return { userKey, userEntry };
  }
  const legacyEntry = config.users[user];
  return legacyEntry ? { userKey: user, userEntry: legacyEntry } : { userKey, userEntry };
}

/**
 * Check whether tokens are registered for a user on the selected platform.
 * @param config - Platform config
 * @param user - User name
 * @param platformConfig - Optional platform connection settings
 * @returns True when the user has a registered token entry
 */
export function hasUserTokenEntry(
  config: PfConfig,
  user: string,
  platformConfig?: PlatformClientConfig,
): boolean {
  return findUserEntry(config, user, platformConfig).userEntry !== undefined;
}

function hasCurrentUserEntry(users: PfConfigV1["users"], currentUser: string): boolean {
  return (
    users[currentUser] !== undefined ||
    Object.keys(users).some((key) => key.endsWith(`|${currentUser}`))
  );
}

/**
 * Migrate a v1 config to v2.
 * Tokens are kept in the config file (storage: "file") during migration.
 * They will be moved to the OS keyring on next login or token refresh.
 * @param v1Config - v1 configuration to migrate
 * @returns Migrated v2 configuration
 */
function migrateV1ToV2(v1Config: PfConfigV1): PfConfig {
  const users: PfConfig["users"] = {};

  for (const [name, v1User] of Object.entries(v1Config.users)) {
    if (!v1User) continue;

    users[name] = {
      access_token: v1User.access_token,
      refresh_token: v1User.refresh_token,
      token_expires_at: v1User.token_expires_at,
      storage: "file",
    };
  }

  return {
    version: LATEST_CONFIG_VERSION,
    min_sdk_version: V2_MIN_SDK_VERSION,
    users,
    profiles: v1Config.profiles,
    current_user: v1Config.current_user,
  };
}

/**
 * Read Tailor Platform CLI configuration, migrating from tailorctl or v1 if necessary.
 * @returns Parsed platform configuration
 */
export async function readPlatformConfig(): Promise<PfConfig> {
  const configPath = platformConfigPath();

  // If platform config doesn't exist, try to read tailorctl config and migrate
  if (!fs.existsSync(configPath)) {
    logger.warn(`Config not found at ${configPath}, migrating from tailorctl config...`);
    const tcConfig = readTailorctlConfig();
    const v1Config = tcConfig
      ? fromTailorctlConfig(tcConfig)
      : ({ version: 1, users: {}, profiles: {}, current_user: null } as const);
    writePlatformConfig(v1Config);
    return migrateV1ToV2(v1Config);
  }

  const rawConfig = parseYAML(fs.readFileSync(configPath, "utf-8"));

  // Legacy installs may have left the config world-readable (umask default
  // 0o644). Tighten it here so users who only run read-only commands still
  // get the secret-file permissions applied without waiting for a write.
  tightenSecretFilePermissions(configPath);

  // Check for unsupported future versions
  const version =
    rawConfig != null && typeof rawConfig === "object" && "version" in rawConfig
      ? (rawConfig as { version: unknown }).version
      : undefined;
  if (typeof version === "number" && version > LATEST_CONFIG_VERSION) {
    const minSdk =
      "min_sdk_version" in (rawConfig as object)
        ? String((rawConfig as { min_sdk_version: unknown }).min_sdk_version)
        : undefined;
    const updateHint = minSdk
      ? `Please update your SDK to >= ${minSdk}: pnpm update @tailor-platform/sdk`
      : "Please update your SDK: pnpm update @tailor-platform/sdk";
    throw new Error(ml`
      Config file uses version ${String(version)}, but this SDK only supports up to version ${String(LATEST_CONFIG_VERSION)}.
      ${updateHint}
    `);
  }

  // Try v2 first
  const v2Result = pfConfigSchemaV2.safeParse(rawConfig);
  if (v2Result.success) {
    if (v2Result.data.latest_min_sdk_version) {
      const packageJson = await readPackageJson();
      const sdkVersion = packageJson.version ?? "0.0.0";
      if (semverLt(sdkVersion, v2Result.data.latest_min_sdk_version)) {
        logger.warn(ml`
          A newer config version (${String(v2Result.data.latest_version)}) is available.
          Please update your SDK to >= ${v2Result.data.latest_min_sdk_version}: pnpm update @tailor-platform/sdk
        `);
      }
    }
    return v2Result.data;
  }

  // Fall back to v1 (convert to v2 in memory, but don't rewrite disk)
  const v1Result = pfConfigSchemaV1.safeParse(rawConfig);
  if (v1Result.success) {
    return migrateV1ToV2(v1Result.data);
  }

  // Neither v1 nor v2
  throw new Error(ml`
    Failed to parse config file at ${configPath}.
    The file may be corrupted or created by an incompatible SDK version.
  `);
}

function toV1ForDisk(config: PfConfig): PfConfigV1 {
  const users: PfConfigV1["users"] = {};
  for (const [name, entry] of Object.entries(config.users)) {
    if (!entry || entry.storage === "keyring") continue;
    users[name] = {
      access_token: entry.access_token,
      refresh_token: entry.refresh_token,
      token_expires_at: entry.token_expires_at,
    };
  }
  const currentUser =
    config.current_user && hasCurrentUserEntry(users, config.current_user)
      ? config.current_user
      : null;
  return {
    version: 1,
    users,
    profiles: config.profiles,
    current_user: currentUser,
  };
}

/**
 * Write Tailor Platform CLI configuration to disk.
 * By default, V2 configs are converted to V1 for backward compatibility, so an
 * older SDK can still read the file. Configs containing a keyring user are kept
 * as V2 regardless, because the keyring storage variant is not representable in
 * V1 and downgrading it would silently drop the user's login. Such configs are
 * already V2 on disk (a keyring entry is only ever persisted with
 * TAILOR_USE_KEYRING set), so keeping V2 does not regress backward compatibility.
 * Set TAILOR_USE_KEYRING to write V2 format unconditionally.
 *
 * The config file may contain access/refresh tokens when the OS keyring is
 * unavailable, so it is written via {@link writeSecretFile} so other users
 * on the host cannot read it.
 * @param config - Platform configuration to write
 */
export function writePlatformConfig(config: PfConfig | PfConfigV1) {
  const configPath = platformConfigPath();
  const hasKeyringUser =
    config.version === 2 && Object.values(config.users).some((u) => u?.storage === "keyring");
  const diskConfig =
    config.version === 2 && !process.env.TAILOR_USE_KEYRING && !hasKeyringUser
      ? toV1ForDisk(config)
      : config;
  writeSecretFile(configPath, stringifyYAML(diskConfig));
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

function fromTailorctlConfig(config: TcConfig): PfConfigV1 {
  const users: PfConfigV1["users"] = {};
  const profiles: PfConfigV1["profiles"] = {};
  let currentUser: PfConfigV1["current_user"] = null;

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
 * In CLI context, env fallback is also handled by politty's arg env option.
 * Priority: opts/workspaceId > env/workspaceId > opts/profile > error
 * @param opts - Workspace and profile options
 * @returns Resolved workspace ID
 */
export async function loadWorkspaceId(opts?: LoadWorkspaceIdOptions): Promise<string> {
  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;

  if (opts?.workspaceId) {
    return validateUUID(opts.workspaceId, "--workspace-id option");
  }

  if (process.env.TAILOR_PLATFORM_WORKSPACE_ID) {
    return validateUUID(
      process.env.TAILOR_PLATFORM_WORKSPACE_ID,
      "TAILOR_PLATFORM_WORKSPACE_ID environment variable",
    );
  }

  if (profile) {
    const pfConfig = await readPlatformConfig();
    const profileEntry = pfConfig.profiles[profile];
    const wsId = profileEntry?.workspace_id;
    if (!wsId) {
      throw new Error(`Profile "${profile}" not found`);
    }
    return validateUUID(wsId, `profile "${profile}"`);
  }

  throw new Error(ml`
    Workspace ID not found.
    Please specify workspace ID via --workspace-id option or TAILOR_PLATFORM_WORKSPACE_ID environment variable.
  `);
}

async function tryLoadPlatformConfigFromProfile(
  profile: string | undefined,
): Promise<PlatformClientConfig | undefined> {
  if (!profile) return undefined;
  try {
    const pfConfig = await readPlatformConfig();
    const profileEntry = pfConfig.profiles[profile];
    if (!profileEntry) return undefined;
    const platformConfig = platformConfigFromProfile(profileEntry);
    return Object.keys(platformConfig).length > 0 ? platformConfig : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Load machine user name from command options, environment variables, or platform config.
 * In CLI context, env fallback is also handled by politty's arg env option.
 * Priority: opts/machineUser > env/TAILOR_PLATFORM_MACHINE_USER_NAME > opts/profile (profile default) > undefined.
 * An explicitly empty `opts.machineUser` is rejected with a CLIError (`MACHINE_USER_NAME_EMPTY`) rather than falling back to the env var or profile default.
 * When the active profile has `machine_user_override: "deny"`, an explicit value that differs from the profile's machine user throws a CLIError with code `PROFILE_MACHINE_USER_OVERRIDE_DENIED`.
 * @param opts - Machine user and profile options
 * @returns Resolved machine user name, or undefined if not set
 */
export async function loadMachineUserName(
  opts?: LoadMachineUserNameOptions,
): Promise<string | undefined> {
  if (opts?.machineUser === "") {
    throw CLIError({
      code: "MACHINE_USER_NAME_EMPTY",
      message: "Machine user name cannot be empty.",
      suggestion:
        "Pass a non-empty machine user name, or omit the option to use the environment variable or profile default.",
    });
  }

  const explicit = opts?.machineUser || process.env.TAILOR_PLATFORM_MACHINE_USER_NAME || undefined;

  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
  if (!profile) return explicit;

  const pfConfig = await readPlatformConfig();
  const entry = pfConfig.profiles[profile];
  if (!entry) {
    if (explicit) return explicit;
    throw new Error(`Profile "${profile}" not found`);
  }

  if (entry.machine_user && entry.machine_user_override === "deny") {
    if (explicit && explicit !== entry.machine_user) {
      throw CLIError({
        code: "PROFILE_MACHINE_USER_OVERRIDE_DENIED",
        message: `Profile "${profile}" denies overriding the machine user.`,
        details: `This profile fixes the machine user to "${entry.machine_user}" for application-data commands.`,
        suggestion: `Omit the machine user option, unset TAILOR_PLATFORM_MACHINE_USER_NAME, or run 'tailor-sdk profile update ${profile} --machine-user-override allow'.`,
      });
    }
    return entry.machine_user;
  }

  return explicit || entry.machine_user;
}

/**
 * Load access token from environment variables, command options, or platform config.
 * In CLI context, profile env fallback is also handled by politty's arg env option.
 * Priority: env/TAILOR_PLATFORM_TOKEN > env/TAILOR_TOKEN (deprecated) > opts/profile > env/profile > config/currentUser > error
 * @param opts - Profile options
 * @returns Resolved access token
 */
export async function loadAccessToken(opts?: LoadAccessTokenOptions) {
  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;

  // env/pat - TAILOR_PLATFORM_TOKEN takes precedence
  if (process.env.TAILOR_PLATFORM_TOKEN) {
    const platformConfig = await tryLoadPlatformConfigFromProfile(profile);
    rememberPlatformConfigForToken(process.env.TAILOR_PLATFORM_TOKEN, platformConfig);
    return process.env.TAILOR_PLATFORM_TOKEN;
  }
  // TAILOR_TOKEN is deprecated
  if (process.env.TAILOR_TOKEN) {
    logger.warn("TAILOR_TOKEN is deprecated. Please use TAILOR_PLATFORM_TOKEN instead.");
    const platformConfig = await tryLoadPlatformConfigFromProfile(profile);
    rememberPlatformConfigForToken(process.env.TAILOR_TOKEN, platformConfig);
    return process.env.TAILOR_TOKEN;
  }

  let pfConfig: PfConfig | undefined;
  let profileEntry: PfProfile | undefined;
  let platformConfig: PlatformClientConfig | undefined;
  if (profile) {
    pfConfig = await readPlatformConfig();
    profileEntry = pfConfig.profiles[profile];
    platformConfig = platformConfigFromProfile(profileEntry);
  }

  pfConfig ??= await readPlatformConfig();
  let user;
  if (profile) {
    const u = profileEntry?.user;
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

  return await fetchLatestToken(pfConfig, user, platformConfig);
}

/**
 * Load platform connection settings from the active profile.
 * @param opts - Profile options
 * @returns Resolved platform connection settings, or undefined for the default environment
 */
export async function loadPlatformClientConfig(
  opts?: LoadPlatformClientConfigOptions,
): Promise<PlatformClientConfig | undefined> {
  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
  if (!profile) {
    return undefined;
  }

  const pfConfig = await readPlatformConfig();
  const profileEntry = pfConfig.profiles[profile];
  if (!profileEntry) {
    throw new Error(`Profile "${profile}" not found`);
  }
  const platformConfig = platformConfigFromProfile(profileEntry);
  return Object.keys(platformConfig).length > 0 ? platformConfig : undefined;
}

/**
 * Load the Tailor Platform Console base URL from environment variables or the active profile.
 * @param opts - Profile options
 * @returns Resolved Console base URL
 */
export async function loadConsoleBaseUrl(opts?: LoadConsoleBaseUrlOptions): Promise<string> {
  const platformConfig = await loadPlatformClientConfig(opts);
  return getConsoleBaseUrl(platformConfig);
}

/**
 * Resolve the actual token values for a user, reading from keyring or config as appropriate.
 * @param userEntry - User entry from the config
 * @param user - User identifier
 * @param label - User-facing identifier used in error messages
 * @returns Access token and optional refresh token
 */
export async function resolveTokens(
  userEntry: PfUserV2,
  user: string,
  label = user,
): Promise<{ accessToken: string; refreshToken?: string }> {
  if (userEntry.storage === "keyring") {
    const tokens = await loadKeyringTokens(user);
    if (!tokens) {
      throw new Error(ml`
        Credentials not found in OS keyring for "${label}".
        Please run 'tailor-sdk login' and try again.
      `);
    }
    return tokens;
  }

  return {
    accessToken: userEntry.access_token,
    refreshToken: userEntry.refresh_token,
  };
}

/**
 * Save tokens for a user, writing to keyring or config as appropriate.
 * @param config - Platform config
 * @param user - User identifier
 * @param tokens - Token data to save
 * @param tokens.accessToken - Access token
 * @param tokens.refreshToken - Refresh token
 * @param expiresAt - Token expiration date
 * @param platformConfig - Optional platform connection settings
 */
export async function saveUserTokens(
  config: PfConfig,
  user: string,
  tokens: { accessToken: string; refreshToken?: string },
  expiresAt: string,
  platformConfig?: PlatformClientConfig,
): Promise<void> {
  const userKey = platformUserKey(user, platformConfig);
  if (process.env.TAILOR_USE_KEYRING && (await isKeyringAvailable())) {
    await saveKeyringTokens(userKey, tokens);
    config.users[userKey] = {
      token_expires_at: expiresAt,
      storage: "keyring",
    };
  } else {
    config.users[userKey] = {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_expires_at: expiresAt,
      storage: "file",
    };
  }
}

/**
 * Delete tokens for a user from keyring if applicable.
 * @param config - Platform config
 * @param user - User identifier
 * @param platformConfig - Optional platform connection settings
 */
export async function deleteUserTokens(
  config: PfConfig,
  user: string,
  platformConfig?: PlatformClientConfig,
): Promise<void> {
  const { userKey, userEntry } = findUserEntry(config, user, platformConfig);
  if (userEntry?.storage === "keyring") {
    await deleteKeyringTokens(userKey);
  }
  delete config.users[userKey];
}

/**
 * Resolve stored tokens for a user on the selected platform.
 * @param config - Platform config
 * @param user - User name
 * @param platformConfig - Optional platform connection settings
 * @returns Stored user entry and token values, or undefined when the user is not logged in
 */
export async function loadStoredUserTokens(
  config: PfConfig,
  user: string,
  platformConfig?: PlatformClientConfig,
): Promise<
  | {
      userEntry: PfUserV2;
      accessToken: string;
      refreshToken?: string;
    }
  | undefined
> {
  const { userKey, userEntry } = findUserEntry(config, user, platformConfig);
  if (!userEntry) return undefined;
  const tokens = await resolveTokens(userEntry, userKey, user);
  return { userEntry, ...tokens };
}

/**
 * Fetch the latest access token, refreshing if necessary.
 * @param config - Platform config
 * @param user - User name
 * @param platformConfig - Optional platform connection settings
 * @returns Latest access token
 */
export async function fetchLatestToken(
  config: PfConfig,
  user: string,
  platformConfig?: PlatformClientConfig,
): Promise<string> {
  const { userKey, userEntry } = findUserEntry(config, user, platformConfig);
  if (!userEntry) {
    throw new Error(ml`
      User "${user}" not found.
      Please verify your user name and login using 'tailor-sdk login' command.
    `);
  }

  const tokens = await resolveTokens(userEntry, userKey, user);

  if (new Date(userEntry.token_expires_at) > new Date()) {
    rememberPlatformConfigForToken(tokens.accessToken, platformConfig);
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    throw new Error(ml`
      Token expired.
      Please run 'tailor-sdk login' and try again.
    `);
  }

  const client = initOAuth2Client(platformConfig);
  let resp;
  try {
    resp = await client.refreshToken({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.parse(userEntry.token_expires_at),
    });
  } catch {
    throw new Error(ml`
      Failed to refresh token. Your session may have expired.
      Please run 'tailor-sdk login' and try again.
    `);
  }

  const newExpiresAt = new Date(
    assertDefined(resp.expiresAt, "token refresh response missing expiresAt"),
  ).toISOString();
  await saveUserTokens(
    config,
    user,
    {
      accessToken: resp.accessToken,
      refreshToken: resp.refreshToken ?? undefined,
    },
    newExpiresAt,
    platformConfig,
  );
  writePlatformConfig(config);
  rememberPlatformConfigForToken(resp.accessToken, platformConfig);
  return resp.accessToken;
}

const DEFAULT_CONFIG_FILENAME = "tailor.config.ts";

/**
 * Load config path from command options, environment variables, or search parent directories.
 * In CLI context, env fallback is also handled by politty's arg env option.
 * Priority: opts/config > env/config > search parent directories
 * @param configPath - Optional explicit config path
 * @returns Resolved config path or undefined
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
