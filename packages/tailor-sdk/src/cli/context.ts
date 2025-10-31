import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseYAML, stringifyYAML, parseTOML } from "confbox";
import { consola } from "consola";
import ml from "multiline-ts";
import { xdgConfig } from "xdg-basedir";
import { z } from "zod";
import { refreshToken } from "./client";

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

export function readPlatformConfig(): PfConfig {
  const configPath = platformConfigPath();

  // If platform config doesn't exist, try to read tailorctl config and migrate
  if (!fs.existsSync(configPath)) {
    consola.warn(
      `Config not found at ${configPath}, migrating from tailorctl config...`,
    );
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
    if (
      !user ||
      new Date(user.token_expires_at) <
        new Date(context.controlplanetokenexpiresat)
    ) {
      users[context.username] = {
        access_token: context.controlplaneaccesstoken,
        refresh_token: context.controlplanerefreshtoken,
        token_expires_at: context.controlplanetokenexpiresat,
      };
    }
  }
  return { version: 1, users, profiles, current_user: currentUser };
}

// Load workspace ID from command options, environment variables, or platform config.
// Priority: opts/workspaceId > env/workspaceId > opts/profile > env/profile > error
export function loadWorkspaceId(opts?: {
  workspaceId?: string;
  profile?: string;
}) {
  // opts/workspaceId
  if (opts?.workspaceId) {
    return opts.workspaceId;
  }

  // env/workspaceId
  if (process.env.TAILOR_PLATFORM_WORKSPACE_ID) {
    return process.env.TAILOR_PLATFORM_WORKSPACE_ID;
  }

  // opts/profile > env/profile
  const profile = opts?.profile || process.env.TAILOR_PLATFORM_PROFILE;
  if (profile) {
    const pfConfig = readPlatformConfig();
    const wsId = pfConfig.profiles[profile]?.workspace_id;
    if (!wsId) {
      throw new Error(`Profile "${profile}" not found`);
    }
    return wsId;
  }

  // error
  throw new Error(ml`
    Workspace ID not found.
    Please specify workspace ID via --workspace-id option or TAILOR_PLATFORM_WORKSPACE_ID environment variable.
  `);
}

// Load access token from command options, environment variables, or platform config.
// Priority: env/pat > opts/profile > env/profile > config/currentUser > error
export async function loadAccessToken(opts?: {
  useProfile?: boolean;
  profile?: string;
}) {
  // env/pat
  if (process.env.TAILOR_PLATFORM_TOKEN) {
    return process.env.TAILOR_PLATFORM_TOKEN;
  }
  if (process.env.TAILOR_TOKEN) {
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

export async function fetchLatestToken(
  config: PfConfig,
  user: string,
): Promise<string> {
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

  const resp = await refreshToken(tokens.refresh_token);
  const newExpiresAt = new Date();
  newExpiresAt.setSeconds(newExpiresAt.getSeconds() + resp.expires_in);
  config.users[user] = {
    access_token: resp.access_token,
    refresh_token: resp.refresh_token,
    token_expires_at: newExpiresAt.toISOString(),
  };
  writePlatformConfig(config);
  return resp.access_token;
}

// Load config path from command options or environment variables.
// Priority: opts/config > env/config > default("tailor.config.ts")
export function loadConfigPath(configPath?: string): string {
  if (configPath) {
    return configPath;
  }
  if (process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH) {
    return process.env.TAILOR_PLATFORM_SDK_CONFIG_PATH;
  }
  return "tailor.config.ts";
}
