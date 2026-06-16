import * as fs from "node:fs";
import * as os from "node:os";
import { parseYAML, stringifyYAML, parseTOML } from "confbox";
import { findUpSync } from "find-up-simple";
import * as path from "pathe";
import { lt as semverLt } from "semver";
import { xdgConfig } from "xdg-basedir";
import { z } from "zod";
import { assertDefined } from "@/utils/assert";
import ml from "@/utils/multiline";
import { fetchUserInfo, initOAuth2Client } from "./client";
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

const pfUserKeyringSchemaV3 = pfUserKeyringSchema.extend({
  email: z.string().optional(),
});

const pfUserFileSchemaV3 = pfUserFileSchema.extend({
  email: z.string().optional(),
});

const pfUserSchemaV3 = z.discriminatedUnion("storage", [pfUserKeyringSchemaV3, pfUserFileSchemaV3]);

const pfConfigSchemaV1 = z.object({
  version: z.literal(1),
  users: z.partialRecord(z.string(), pfUserSchemaV1),
  profiles: z.partialRecord(z.string(), pfProfileSchema),
  current_user: z.string().nullable(),
});

const V2_CONFIG_VERSION = 2;
const LATEST_CONFIG_VERSION = 3;
const V2_MIN_SDK_VERSION = "1.29.0";
const V3_MIN_SDK_VERSION = "2.0.0";

const semverSchema = z.templateLiteral([
  z.number().int(),
  ".",
  z.number().int(),
  ".",
  z.number().int(),
]);

const pfConfigSchemaV2 = z.object({
  version: z.literal(V2_CONFIG_VERSION),
  min_sdk_version: semverSchema,
  latest_version: z.number().int().optional(),
  latest_min_sdk_version: semverSchema.optional(),
  users: z.partialRecord(z.string(), pfUserSchemaV2),
  profiles: z.partialRecord(z.string(), pfProfileSchema),
  current_user: z.string().nullable(),
});

const pfConfigSchemaV3 = z.object({
  version: z.literal(LATEST_CONFIG_VERSION),
  min_sdk_version: semverSchema,
  latest_version: z.number().int().optional(),
  latest_min_sdk_version: semverSchema.optional(),
  users: z.partialRecord(z.string(), pfUserSchemaV3),
  profiles: z.partialRecord(z.string(), pfProfileSchema),
  current_user: z.string().nullable(),
});

type PfConfigV1 = z.output<typeof pfConfigSchemaV1>;
type PfConfigV2 = z.output<typeof pfConfigSchemaV2>;
type PfConfig = z.output<typeof pfConfigSchemaV3>;
type PfUser = z.output<typeof pfUserSchemaV3>;
type LoadWorkspaceIdOptions = {
  workspaceId?: string;
  profile?: string;
};
type LoadAccessTokenOptions = {
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

/**
 * Migrate a v1 config to v2.
 * Tokens are kept in the config file (storage: "file") during migration.
 * They will be moved to the OS keyring on next login or token refresh.
 * @param v1Config - v1 configuration to migrate
 * @returns Migrated v2 configuration
 */
function migrateV1ToV2(v1Config: PfConfigV1): PfConfigV2 {
  const users: PfConfigV2["users"] = {};

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
    version: V2_CONFIG_VERSION,
    min_sdk_version: V2_MIN_SDK_VERSION,
    users,
    profiles: v1Config.profiles,
    current_user: v1Config.current_user,
  };
}

function inferEmailFromUserId(user: string): string | undefined {
  return z.email().safeParse(user).success ? user : undefined;
}

export function findConfigUserKey(config: PfConfig, user: string): string | undefined {
  if (config.users[user]) return user;
  return Object.entries(config.users).find(([, entry]) => entry?.email === user)?.[0];
}

function migrateV2ToV3(v2Config: PfConfigV2): PfConfig {
  const users: PfConfig["users"] = {};

  for (const [user, entry] of Object.entries(v2Config.users)) {
    if (!entry) continue;
    const email = inferEmailFromUserId(user);
    users[user] = {
      ...entry,
      ...(email ? { email } : {}),
    };
  }

  return {
    version: LATEST_CONFIG_VERSION,
    min_sdk_version: V3_MIN_SDK_VERSION,
    users,
    profiles: v2Config.profiles,
    current_user: v2Config.current_user,
  };
}

function migrateV1ToV3(v1Config: PfConfigV1): PfConfig {
  return migrateV2ToV3(migrateV1ToV2(v1Config));
}

async function warnIfNewerConfigAvailable(config: {
  latest_version?: number;
  latest_min_sdk_version?: string;
}) {
  if (!config.latest_min_sdk_version) return;
  const packageJson = await readPackageJson();
  const sdkVersion = packageJson.version ?? "0.0.0";
  if (semverLt(sdkVersion, config.latest_min_sdk_version)) {
    logger.warn(ml`
      A newer config version (${String(config.latest_version)}) is available.
      Please update your SDK to >= ${config.latest_min_sdk_version}: pnpm update @tailor-platform/sdk
    `);
  }
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
    return migrateV1ToV3(v1Config);
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

  // Try v3 first
  const v3Result = pfConfigSchemaV3.safeParse(rawConfig);
  if (v3Result.success) {
    await warnIfNewerConfigAvailable(v3Result.data);
    return v3Result.data;
  }

  // Try v2 next
  const v2Result = pfConfigSchemaV2.safeParse(rawConfig);
  if (v2Result.success) {
    await warnIfNewerConfigAvailable(v2Result.data);
    return migrateV2ToV3(v2Result.data);
  }

  // Fall back to v1 (convert to v3 in memory, but don't rewrite disk)
  const v1Result = pfConfigSchemaV1.safeParse(rawConfig);
  if (v1Result.success) {
    return migrateV1ToV3(v1Result.data);
  }

  // Neither v1, v2, nor v3
  throw new Error(ml`
    Failed to parse config file at ${configPath}.
    The file may be corrupted or created by an incompatible SDK version.
  `);
}

function toV1ForDisk(config: PfConfigV2): PfConfigV1 {
  const users: PfConfigV1["users"] = {};
  for (const [name, entry] of Object.entries(config.users)) {
    if (!entry || entry.storage === "keyring") continue;
    users[name] = {
      access_token: entry.access_token,
      refresh_token: entry.refresh_token,
      token_expires_at: entry.token_expires_at,
    };
  }
  // Clear current_user when it points at a user missing from the rebuilt v1
  // users map, so the downgraded file never references a non-existent user.
  const currentUser =
    config.current_user && users[config.current_user] ? config.current_user : null;
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
 * V1 and downgrading it would silently drop the user's login. V3 configs are
 * kept as V3 because user keys are canonical subject IDs and may include email
 * metadata that is not representable in older versions.
 * Set TAILOR_USE_KEYRING to write V2 format unconditionally.
 *
 * The config file may contain access/refresh tokens when the OS keyring is
 * unavailable, so it is written via {@link writeSecretFile} so other users
 * on the host cannot read it.
 * @param config - Platform configuration to write
 */
export function writePlatformConfig(config: PfConfig | PfConfigV2 | PfConfigV1) {
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
  if (opts?.workspaceId) {
    return validateUUID(opts.workspaceId, "--workspace-id option");
  }

  if (process.env.TAILOR_PLATFORM_WORKSPACE_ID) {
    return validateUUID(
      process.env.TAILOR_PLATFORM_WORKSPACE_ID,
      "TAILOR_PLATFORM_WORKSPACE_ID environment variable",
    );
  }

  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
  if (profile) {
    const pfConfig = await readPlatformConfig();
    const wsId = pfConfig.profiles[profile]?.workspace_id;
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
  // env/pat - TAILOR_PLATFORM_TOKEN takes precedence
  if (process.env.TAILOR_PLATFORM_TOKEN) {
    return process.env.TAILOR_PLATFORM_TOKEN;
  }
  // TAILOR_TOKEN is deprecated
  if (process.env.TAILOR_TOKEN) {
    logger.warn("TAILOR_TOKEN is deprecated. Please use TAILOR_PLATFORM_TOKEN instead.");
    return process.env.TAILOR_TOKEN;
  }

  const pfConfig = await readPlatformConfig();
  let user;
  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
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

  return (await fetchLatestToken(pfConfig, user)).accessToken;
}

/**
 * Resolve the actual token values for a user, reading from keyring or config as appropriate.
 * @param userEntry - User entry from the config
 * @param user - User identifier
 * @returns Access token and optional refresh token
 */
export async function resolveTokens(
  userEntry: PfUser,
  user: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  if (userEntry.storage === "keyring") {
    const tokens = await loadKeyringTokens(user);
    if (!tokens) {
      throw new Error(ml`
        Credentials not found in OS keyring for "${user}".
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
 * @param tokens.accessToken - Access token to save
 * @param tokens.refreshToken - Optional refresh token to save
 * @param expiresAt - Token expiration date
 * @param metadata - Optional user metadata to persist with the token entry
 */
export async function saveUserTokens(
  config: PfConfig,
  user: string,
  tokens: { accessToken: string; refreshToken?: string },
  expiresAt: string,
  metadata?: { email?: string },
): Promise<void> {
  const email = metadata?.email ?? config.users[user]?.email;
  if (process.env.TAILOR_USE_KEYRING && (await isKeyringAvailable())) {
    await saveKeyringTokens(user, tokens);
    config.users[user] = {
      token_expires_at: expiresAt,
      storage: "keyring",
      ...(email ? { email } : {}),
    };
  } else {
    config.users[user] = {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_expires_at: expiresAt,
      storage: "file",
      ...(email ? { email } : {}),
    };
  }
}

/**
 * Delete tokens for a user from keyring if applicable.
 * @param config - Platform config
 * @param user - User identifier
 */
export async function deleteUserTokens(config: PfConfig, user: string): Promise<void> {
  const userEntry = config.users[user];
  if (userEntry?.storage === "keyring") {
    await deleteKeyringTokens(user);
  }
}

function updateUserReferences(config: PfConfig, fromUser: string, toUser: string) {
  if (fromUser === toUser) return;
  if (config.current_user === fromUser) {
    config.current_user = toUser;
  }
  for (const profile of Object.values(config.profiles)) {
    if (profile?.user === fromUser) {
      profile.user = toUser;
    }
  }
}

/**
 * Remove a legacy alias after a canonical user ID has been written.
 * @param config - Platform config
 * @param legacyUser - Previous user key
 * @param canonicalUser - Canonical user key
 */
export async function removeLegacyUserAlias(
  config: PfConfig,
  legacyUser: string,
  canonicalUser: string,
): Promise<void> {
  if (legacyUser === canonicalUser) return;
  updateUserReferences(config, legacyUser, canonicalUser);
  await deleteUserTokens(config, legacyUser);
  delete config.users[legacyUser];
}

function shouldResolveSubjectOnRefresh(user: string, userEntry: PfUser): boolean {
  return Boolean(userEntry.email || inferEmailFromUserId(user));
}

/**
 * Fetch the latest access token, refreshing if necessary.
 * @param config - Platform config
 * @param user - User identifier
 * @returns Latest access token and the canonical user ID it is stored under
 *   (the resolved subject when a legacy email key was migrated during refresh,
 *   otherwise the matching config user)
 */
export async function fetchLatestToken(
  config: PfConfig,
  user: string,
): Promise<{ accessToken: string; user: string }> {
  const storedUser = findConfigUserKey(config, user);
  if (!storedUser) {
    throw new Error(ml`
      User "${user}" not found.
      Please verify your user name and login using 'tailor-sdk login' command.
    `);
  }

  const userEntry = config.users[storedUser];
  if (!userEntry) {
    throw new Error(ml`
      User "${user}" not found.
      Please verify your user name and login using 'tailor-sdk login' command.
    `);
  }

  const tokens = await resolveTokens(userEntry, storedUser);

  if (new Date(userEntry.token_expires_at) > new Date()) {
    return { accessToken: tokens.accessToken, user: storedUser };
  }

  if (!tokens.refreshToken) {
    throw new Error(ml`
      Token expired.
      Please run 'tailor-sdk login' and try again.
    `);
  }

  const client = initOAuth2Client();
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

  let resolvedUser = storedUser;
  const previousEmail = userEntry.email ?? inferEmailFromUserId(storedUser);
  let email = previousEmail;
  if (shouldResolveSubjectOnRefresh(storedUser, userEntry)) {
    try {
      const userInfo = await fetchUserInfo(resp.accessToken);
      resolvedUser = userInfo.sub;
      email = userInfo.email;
    } catch (error) {
      logger.debug(`Failed to resolve refreshed token user info: ${String(error)}`);
    }
  }

  await saveUserTokens(
    config,
    resolvedUser,
    {
      accessToken: resp.accessToken,
      refreshToken: resp.refreshToken ?? undefined,
    },
    newExpiresAt,
    { email },
  );
  await removeLegacyUserAlias(config, storedUser, resolvedUser);
  if (previousEmail && email && previousEmail !== email) {
    logger.info(`Updated local user email from "${previousEmail}" to "${email}".`);
  }
  writePlatformConfig(config);
  return { accessToken: resp.accessToken, user: resolvedUser };
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
