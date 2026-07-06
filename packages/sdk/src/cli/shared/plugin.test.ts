import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getOAuth2ClientId, getPlatformBaseUrl } from "./client";
import { dispatchPlugin, listPlugins, resolvePlugin } from "./plugin";

const contextMocks = vi.hoisted(() => ({
  loadAccessToken: vi.fn(),
  loadWorkspaceId: vi.fn(),
  loadConfigPath: vi.fn(),
  loadPlatformClientConfig: vi.fn(),
  readPlatformConfig: vi.fn(),
}));

vi.mock("./context", () => contextMocks);

const isWindows = process.platform === "win32";
const CLI = "tailor-sdk";

/**
 * Create an executable fake plugin file.
 * @param dir - Directory to create the file in
 * @param name - File name
 * @returns Absolute path to the created file
 */
function writeExecutable(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  fs.writeFileSync(full, "#!/bin/sh\necho hi\n");
  if (!isWindows) fs.chmodSync(full, 0o755);
  return full;
}

describe("resolvePlugin / listPlugins", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tailor-plugin-")));
    originalCwd = process.cwd();
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("resolves a plugin from the nearest node_modules/.bin", () => {
    const project = path.join(tempDir, "project");
    const binDir = path.join(project, "node_modules", ".bin");
    const exe = writeExecutable(binDir, `${CLI}-hello`);
    process.chdir(project);
    process.env.PATH = "";

    const resolved = resolvePlugin("hello", CLI);
    expect(resolved).toEqual({ name: "hello", path: exe, source: "node_modules" });
  });

  test("resolves a plugin from PATH when not in node_modules", () => {
    const project = path.join(tempDir, "project");
    fs.mkdirSync(project, { recursive: true });
    const pathDir = path.join(tempDir, "bin");
    const exe = writeExecutable(pathDir, `${CLI}-frompath`);
    process.chdir(project);
    process.env.PATH = pathDir;

    const resolved = resolvePlugin("frompath", CLI);
    expect(resolved).toEqual({ name: "frompath", path: exe, source: "path" });
  });

  test("prefers node_modules/.bin over PATH on collision", () => {
    const project = path.join(tempDir, "project");
    const binDir = path.join(project, "node_modules", ".bin");
    const nmExe = writeExecutable(binDir, `${CLI}-dup`);
    const pathDir = path.join(tempDir, "bin");
    writeExecutable(pathDir, `${CLI}-dup`);
    process.chdir(project);
    process.env.PATH = pathDir;

    const resolved = resolvePlugin("dup", CLI);
    expect(resolved?.source).toBe("node_modules");
    expect(resolved?.path).toBe(nmExe);
  });

  test("returns null when no matching plugin exists", () => {
    const project = path.join(tempDir, "project");
    fs.mkdirSync(project, { recursive: true });
    process.chdir(project);
    process.env.PATH = "";

    expect(resolvePlugin("missing", CLI)).toBeNull();
  });

  test("rejects names containing path separators or NUL", () => {
    // A traversal-shaped name must never resolve, even if such a file exists.
    const binDir = path.join(tempDir, "project", "node_modules", ".bin");
    writeExecutable(binDir, `${CLI}-evil`);
    process.chdir(path.join(tempDir, "project"));
    process.env.PATH = "";

    expect(resolvePlugin("../evil", CLI)).toBeNull();
    expect(resolvePlugin("a/b", CLI)).toBeNull();
    expect(resolvePlugin("a\\b", CLI)).toBeNull();
    expect(resolvePlugin("a\0b", CLI)).toBeNull();
  });

  test("lists discovered plugins, deduping by name with node_modules precedence", () => {
    const project = path.join(tempDir, "project");
    const binDir = path.join(project, "node_modules", ".bin");
    writeExecutable(binDir, `${CLI}-alpha`);
    writeExecutable(binDir, `${CLI}-dup`);
    const pathDir = path.join(tempDir, "bin");
    writeExecutable(pathDir, `${CLI}-beta`);
    writeExecutable(pathDir, `${CLI}-dup`);
    // A non-plugin executable must be ignored.
    writeExecutable(pathDir, "unrelated-tool");
    process.chdir(project);
    process.env.PATH = pathDir;

    const plugins = listPlugins(CLI);
    const byName = Object.fromEntries(plugins.map((p) => [p.name, p]));

    expect(Object.keys(byName).toSorted()).toEqual(["alpha", "beta", "dup"]);
    expect(byName.alpha?.source).toBe("node_modules");
    expect(byName.beta?.source).toBe("path");
    expect(byName.dup?.source).toBe("node_modules");
  });
});

/**
 * Write an executable node plugin that dumps its env and forwarded argv to
 * `outFile` as JSON, then exits with `exitCode`.
 * @param dir - Directory to create the plugin in
 * @param name - Plugin file name
 * @param outFile - Path the plugin writes its captured context to
 * @param exitCode - Exit code the plugin terminates with
 * @returns Absolute path to the created plugin
 */
function writeCapturePlugin(dir: string, name: string, outFile: string, exitCode = 0): string {
  fs.mkdirSync(dir, { recursive: true });
  const jsBody = `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ env: process.env, argv: process.argv.slice(2) }));
process.exit(${exitCode});
`;
  if (isWindows) {
    // Windows can't execute a shebang script directly, so ship a `.cmd` wrapper
    // that runs Node (by absolute path, so PATH need not contain node) on a
    // companion `.js` file. This exercises the `.cmd` dispatch branch.
    const jsPath = path.join(dir, `${name}.js`);
    fs.writeFileSync(jsPath, jsBody);
    const cmdPath = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(cmdPath, `@"${process.execPath}" "${jsPath}" %*\r\n`);
    return cmdPath;
  }
  const full = path.join(dir, name);
  fs.writeFileSync(full, `#!${process.execPath}\n${jsBody}`);
  fs.chmodSync(full, 0o755);
  return full;
}

// Context vars that may be present in the ambient environment; cleared so the
// dispatched child only sees what buildPluginEnv injects.
const CONTEXT_ENV_KEYS = [
  "TAILOR_PLATFORM_TOKEN",
  "TAILOR_PLATFORM_WORKSPACE_ID",
  "TAILOR_PLATFORM_USER",
  "TAILOR_CONFIG_PATH",
  "TAILOR_PLATFORM_PROFILE",
] as const;

describe("dispatchPlugin", () => {
  let tempDir: string;
  let originalCwd: string;
  let originalPath: string | undefined;
  let originalContextEnv: Record<string, string | undefined>;
  let outFile: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tailor-dispatch-")));
    originalCwd = process.cwd();
    originalPath = process.env.PATH;
    originalContextEnv = Object.fromEntries(CONTEXT_ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of CONTEXT_ENV_KEYS) delete process.env[k];
    outFile = path.join(tempDir, "capture.json");

    contextMocks.loadAccessToken.mockResolvedValue("tok-123");
    contextMocks.loadWorkspaceId.mockResolvedValue("ws-456");
    contextMocks.loadConfigPath.mockReturnValue("/proj/tailor.config.ts");
    contextMocks.loadPlatformClientConfig.mockResolvedValue(undefined);
    contextMocks.readPlatformConfig.mockResolvedValue({
      users: { u1: { email: "me@example.com" } },
      profiles: {},
      current_user: "u1",
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    for (const [k, v] of Object.entries(originalContextEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Read the JSON context captured by the dispatched plugin.
   * @returns The plugin's env and forwarded argv
   */
  function readCapture(): { env: Record<string, string>; argv: string[] } {
    return JSON.parse(fs.readFileSync(outFile, "utf-8"));
  }

  test("forwards args and injects the resolved platform context", async () => {
    const project = path.join(tempDir, "project");
    writeCapturePlugin(path.join(project, "node_modules", ".bin"), `${CLI}-hello`, outFile);
    process.chdir(project);
    process.env.PATH = "";

    const code = await dispatchPlugin({
      name: "hello",
      args: ["world", "--loud"],
      cliName: CLI,
    });

    expect(code).toBe(0);
    const { env, argv } = readCapture();
    expect(argv).toEqual(["world", "--loud"]);
    expect(env.TAILOR_PLATFORM_URL).toBe(getPlatformBaseUrl());
    expect(env.TAILOR_PLATFORM_OAUTH2_CLIENT_ID).toBe(getOAuth2ClientId());
    expect(env.TAILOR_PLATFORM_TOKEN).toBe("tok-123");
    expect(env.TAILOR_PLATFORM_WORKSPACE_ID).toBe("ws-456");
    expect(env.TAILOR_PLATFORM_USER).toBe("me@example.com");
    expect(env.TAILOR_CONFIG_PATH).toBe("/proj/tailor.config.ts");
    expect(env.TAILOR_BIN).toBeTruthy();
    expect(env.TAILOR_VERSION).toBeTruthy();
  });

  test("injects the active profile's platform URL and OAuth client", async () => {
    contextMocks.loadPlatformClientConfig.mockResolvedValue({
      platformUrl: "https://api.staging.example.com",
      oauth2ClientId: "cpoc_staging",
    });
    const project = path.join(tempDir, "project");
    writeCapturePlugin(path.join(project, "node_modules", ".bin"), `${CLI}-hello`, outFile);
    process.chdir(project);
    process.env.PATH = "";

    const code = await dispatchPlugin({
      name: "hello",
      args: [],
      cliName: CLI,
      profile: "staging",
    });

    expect(code).toBe(0);
    const { env } = readCapture();
    expect(env.TAILOR_PLATFORM_URL).toBe("https://api.staging.example.com");
    expect(env.TAILOR_PLATFORM_OAUTH2_CLIENT_ID).toBe("cpoc_staging");
  });

  test("omits best-effort context when it cannot be resolved but still dispatches", async () => {
    contextMocks.loadAccessToken.mockRejectedValue(new Error("not logged in"));
    contextMocks.loadWorkspaceId.mockRejectedValue(new Error("no workspace"));
    contextMocks.readPlatformConfig.mockResolvedValue({
      users: {},
      profiles: {},
      current_user: null,
    });

    const project = path.join(tempDir, "project");
    writeCapturePlugin(path.join(project, "node_modules", ".bin"), `${CLI}-hello`, outFile);
    process.chdir(project);
    process.env.PATH = "";

    const code = await dispatchPlugin({ name: "hello", args: [], cliName: CLI });

    expect(code).toBe(0);
    const { env } = readCapture();
    expect(env.TAILOR_PLATFORM_TOKEN).toBeUndefined();
    expect(env.TAILOR_PLATFORM_WORKSPACE_ID).toBeUndefined();
    expect(env.TAILOR_PLATFORM_USER).toBeUndefined();
    expect(env.TAILOR_PLATFORM_URL).toBe(getPlatformBaseUrl());
  });

  test("builds the plugin slug from the command path for nested dispatch", async () => {
    const project = path.join(tempDir, "project");
    writeCapturePlugin(path.join(project, "node_modules", ".bin"), `${CLI}-tailordb-erd`, outFile);
    process.chdir(project);
    process.env.PATH = "";

    const code = await dispatchPlugin({
      commandPath: ["tailordb"],
      name: "erd",
      args: ["export"],
      cliName: CLI,
    });

    expect(code).toBe(0);
    expect(readCapture().argv).toEqual(["export"]);
  });

  test("propagates a non-zero exit code", async () => {
    const project = path.join(tempDir, "project");
    writeCapturePlugin(path.join(project, "node_modules", ".bin"), `${CLI}-boom`, outFile, 3);
    process.chdir(project);
    process.env.PATH = "";

    const code = await dispatchPlugin({ name: "boom", args: [], cliName: CLI });
    expect(code).toBe(3);
  });

  test("returns undefined when no matching plugin exists", async () => {
    const project = path.join(tempDir, "project");
    fs.mkdirSync(project, { recursive: true });
    process.chdir(project);
    process.env.PATH = "";

    expect(await dispatchPlugin({ name: "missing", args: [], cliName: CLI })).toBeUndefined();
  });
});
