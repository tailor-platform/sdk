import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { getOAuth2ClientId, getPlatformBaseUrl, type PlatformClientConfig } from "./client";
import {
  loadAccessToken,
  loadConfigPath,
  loadPlatformClientConfig,
  loadWorkspaceId,
  readPlatformConfig,
} from "./context";
import { logger } from "./logger";
import { readPackageJson } from "./package-json";

/**
 * A plugin discovered on the filesystem. `tailor <name>` dispatches to the
 * external `tailor-<name>` executable.
 */
export interface DiscoveredPlugin {
  /** Plugin name (the part after the `<cli>-` prefix). */
  name: string;
  /** Absolute path to the executable. */
  path: string;
  /** Where the executable was found. */
  source: "node_modules" | "path";
}

/** PATH entry separator (`;` on Windows, `:` elsewhere). */
const pathDelimiter = process.platform === "win32" ? ";" : ":";

/**
 * Yield `start` and each ancestor directory up to the filesystem root.
 * @param start - Directory to start from
 * @yields Each ancestor directory, starting with `start`
 */
function* ancestorDirs(start: string): Generator<string> {
  let dir = path.resolve(start);
  // Walk up until `dirname` stops changing (the filesystem root), yielding the
  // root on the final iteration.
  let parent = path.dirname(dir);
  while (parent !== dir) {
    yield dir;
    dir = parent;
    parent = path.dirname(dir);
  }
  yield dir;
}

/** Fallback executable extensions when `PATHEXT` is unset (Windows). */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD;.PS1";

/**
 * Lowercased executable extensions from `PATHEXT` (Windows).
 * @returns Recognized executable extensions (e.g. `.exe`, `.cmd`)
 */
function windowsExecutableExts(): string[] {
  return (process.env.PATHEXT ?? DEFAULT_PATHEXT)
    .split(";")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Check whether a path exists and is runnable: X_OK on POSIX; on Windows, the
 * file must exist and either be extension-less (shebang script) or carry a
 * `PATHEXT` extension, so plain data files are not mistaken for plugins.
 * @param filePath - Path to check
 * @returns Whether the path is an executable file
 */
function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  } catch {
    return false;
  }
  if (process.platform === "win32") {
    const ext = path.extname(filePath).toLowerCase();
    return ext === "" || windowsExecutableExts().includes(ext);
  }
  return true;
}

/**
 * Candidate file names for a plugin binary, accounting for Windows extensions.
 * @param binName - Base binary name (e.g. `tailor-foo`)
 * @returns Ordered candidate file names
 */
function binaryCandidates(binName: string): string[] {
  if (process.platform !== "win32") {
    return [binName];
  }
  // Bare name first (shebang scripts), then PATHEXT variants.
  return [binName, ...windowsExecutableExts().map((ext) => `${binName}${ext}`)];
}

/**
 * Directories on the user's PATH.
 * @returns PATH entries
 */
function pathDirs(): string[] {
  return (process.env.PATH ?? "").split(pathDelimiter).filter(Boolean);
}

/**
 * Nearest `node_modules/.bin` directories, walking up from the current working
 * directory. Project-local bins take precedence over those higher in the tree.
 * @returns Ordered `node_modules/.bin` directories
 */
function nodeModulesBinDirs(): string[] {
  const dirs: string[] = [];
  for (const dir of ancestorDirs(process.cwd())) {
    dirs.push(path.join(dir, "node_modules", ".bin"));
  }
  return dirs;
}

/**
 * Find the first existing executable for the given base name across a set of
 * directories.
 * @param dirs - Directories to search
 * @param binName - Base binary name
 * @returns Absolute path, or undefined when not found
 */
function findExecutableIn(dirs: string[], binName: string): string | undefined {
  const candidates = binaryCandidates(binName);
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (isExecutable(full)) return full;
    }
  }
  return undefined;
}

/**
 * Resolve a plugin executable by name.
 * Search order: project-local `node_modules/.bin` (nearest first), then PATH.
 * @param name - Plugin name (without the `<cli>-` prefix)
 * @param cliName - The host CLI name (e.g. `tailor`)
 * @returns The discovered plugin, or null when not found
 */
export function resolvePlugin(name: string, cliName: string): DiscoveredPlugin | null {
  // Reject names that could escape the `<cli>-` prefix via path traversal
  // (e.g. `../evil`) or embed a NUL, before joining them into a filesystem path.
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return null;
  }
  const binName = `${cliName}-${name}`;

  const fromNodeModules = findExecutableIn(nodeModulesBinDirs(), binName);
  if (fromNodeModules) {
    return { name, path: fromNodeModules, source: "node_modules" };
  }

  const fromPath = findExecutableIn(pathDirs(), binName);
  if (fromPath) {
    return { name, path: fromPath, source: "path" };
  }

  return null;
}

/**
 * Strip a known binary extension from a file name (Windows).
 * @param fileName - File name
 * @returns File name without a recognized executable extension
 */
function stripBinExt(fileName: string): string {
  if (process.platform !== "win32") return fileName;
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/**
 * Discover all plugins reachable from `node_modules/.bin` and PATH.
 * Earlier entries win on name collisions (project-local over PATH).
 * @param cliName - The host CLI name (e.g. `tailor`)
 * @returns Discovered plugins, deduped by name
 */
export function listPlugins(cliName: string): DiscoveredPlugin[] {
  const prefix = `${cliName}-`;
  const seen = new Map<string, DiscoveredPlugin>();

  const scan = (dirs: string[], source: DiscoveredPlugin["source"]) => {
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const base = stripBinExt(entry);
        if (!base.startsWith(prefix) || base.length === prefix.length) continue;
        const name = base.slice(prefix.length);
        if (seen.has(name)) continue;
        const full = path.join(dir, entry);
        if (!isExecutable(full)) continue;
        seen.set(name, { name, path: full, source });
      }
    }
  };

  scan(nodeModulesBinDirs(), "node_modules");
  scan(pathDirs(), "path");

  return [...seen.values()];
}

/**
 * Options for {@link buildPluginEnv}.
 */
interface PluginContextOptions {
  /** Active profile used to resolve the workspace, user, and token. */
  profile?: string | undefined;
}

/**
 * Resolve the active user identifier, preferring the stored email over the
 * internal user key.
 * @param profile - Active profile name, if any
 * @returns The resolved user (email when known), or undefined when not logged in
 */
async function resolveActiveUser(profile?: string): Promise<string | undefined> {
  const config = await readPlatformConfig();
  const user = profile ? config.profiles[profile]?.user : config.current_user;
  if (!user) return undefined;
  return config.users[user]?.email ?? user;
}

/**
 * Build the environment variables injected into a dispatched plugin.
 * Workspace, user, and token are resolved best-effort: whichever the current
 * context can provide is injected, and the rest are omitted so auth-free
 * plugins still run.
 * @param options - Plugin context options
 * @returns Environment variables to merge into the child process env
 */
async function buildPluginEnv(options: PluginContextOptions = {}): Promise<Record<string, string>> {
  const { profile } = options;
  // Resolve the active profile's platform settings so the injected URL and
  // OAuth client match the profile the token and workspace belong to.
  let platformConfig: PlatformClientConfig | undefined;
  try {
    platformConfig = await loadPlatformClientConfig({ profile, allowMissingProfile: true });
  } catch {
    // Fall back to env/default platform settings when the profile is unreadable.
  }
  const env: Record<string, string> = {
    TAILOR_PLATFORM_URL: getPlatformBaseUrl(platformConfig),
    TAILOR_PLATFORM_OAUTH2_CLIENT_ID: getOAuth2ClientId(platformConfig),
  };

  const binPath = process.argv[1];
  if (binPath) {
    env.TAILOR_BIN = binPath;
  }

  try {
    const { version } = await readPackageJson();
    if (version) env.TAILOR_VERSION = version;
  } catch {
    // Version is informational; skip when unavailable.
  }

  const configPath = loadConfigPath();
  if (configPath) {
    env.TAILOR_CONFIG_PATH = configPath;
  }

  try {
    env.TAILOR_PLATFORM_WORKSPACE_ID = await loadWorkspaceId({ profile });
  } catch {
    // No workspace resolvable; plugins that need it surface their own error.
  }

  try {
    const user = await resolveActiveUser(profile);
    if (user) env.TAILOR_PLATFORM_USER = user;
  } catch {
    // User context is best-effort; skip when the config is unreadable.
  }

  try {
    const token = await loadAccessToken({ profile });
    if (token) env.TAILOR_PLATFORM_TOKEN = token;
  } catch {
    // Not logged in (or no token): dispatch without a token so auth-free
    // plugins still work. Auth-requiring plugins surface their own error
    // (e.g. via `tailor auth token`).
  }

  return env;
}

/**
 * Map an exit signal to a conventional exit code (128 + signal number).
 * @param signal - Signal name
 * @returns Exit code
 */
function signalToExitCode(signal: NodeJS.Signals): number {
  const num = os.constants.signals[signal];
  return typeof num === "number" ? 128 + num : 1;
}

/**
 * Build the command + args for spawning a plugin, handling Windows shebang
 * scripts via `sh` (following the `gh` extension dispatcher).
 * @param pluginPath - Resolved plugin executable path
 * @param args - Args to forward to the plugin
 * @returns Spawn command, args, and whether a shell is required
 */
function buildSpawnTarget(
  pluginPath: string,
  args: readonly string[],
): { command: string; args: string[]; shell: boolean } {
  if (process.platform !== "win32") {
    return { command: pluginPath, args: [...args], shell: false };
  }

  const ext = path.extname(pluginPath).toLowerCase();
  if (ext === ".exe" || ext === ".com") {
    return { command: pluginPath, args: [...args], shell: false };
  }
  if (ext === ".cmd" || ext === ".bat") {
    // .cmd/.bat must run through the shell on Windows.
    return { command: pluginPath, args: [...args], shell: true };
  }
  if (ext === ".ps1") {
    // PowerShell scripts are not directly executable via spawn.
    const pwsh =
      findExecutableIn(pathDirs(), "pwsh") ??
      findExecutableIn(pathDirs(), "powershell") ??
      "powershell";
    return {
      command: pwsh,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", pluginPath, ...args],
      shell: false,
    };
  }

  // Extension-less shebang script: dispatch through `sh` (Git for Windows).
  const sh = findExecutableIn(pathDirs(), "sh") ?? "sh";
  return { command: sh, args: ["-c", 'command "$@"', "--", pluginPath, ...args], shell: false };
}

/**
 * Resolve and execute a plugin, forwarding stdio and propagating its exit code.
 * @param params - Dispatch parameters
 * @param params.name - Plugin name (without the `<cli>-` prefix)
 * @param params.args - Args to forward to the plugin
 * @param params.cliName - The host CLI name
 * @param params.profile - Active profile name, if any
 * @returns The plugin's exit code, or undefined when no matching plugin exists
 */
export async function dispatchPlugin(params: {
  name: string;
  args: readonly string[];
  cliName: string;
  commandPath?: readonly string[] | undefined;
  profile?: string | undefined;
}): Promise<number | undefined> {
  // Build the plugin slug from the known command path plus the unknown name,
  // so `tailor tailordb erd` resolves `tailor-tailordb-erd`.
  const slug = [...(params.commandPath ?? []), params.name].join("-");
  const plugin = resolvePlugin(slug, params.cliName);
  if (!plugin) {
    return undefined;
  }

  const env = { ...process.env, ...(await buildPluginEnv({ profile: params.profile })) };
  const { command, args, shell } = buildSpawnTarget(plugin.path, params.args);

  return await new Promise<number>((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", env, shell });
    child.on("error", (error) => {
      logger.error(`Failed to run plugin "${params.cliName}-${slug}": ${error.message}`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        resolve(signalToExitCode(signal));
      } else {
        resolve(code ?? 0);
      }
    });
  });
}
