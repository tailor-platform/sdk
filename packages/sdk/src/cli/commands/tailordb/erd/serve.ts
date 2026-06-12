import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { glob } from "node:fs/promises";
import * as http from "node:http";
import { watch, type FSWatcher } from "chokidar";
import { lookup as lookupMime } from "mime-types";
import open from "open";
import * as path from "pathe";
import { arg } from "politty";
import { z } from "zod";
import { configArg } from "@/cli/shared/args";
import { defineAppCommand } from "@/cli/shared/command";
import { loadConfig, type LoadedConfig } from "@/cli/shared/config-loader";
import { logger } from "@/cli/shared/logger";
import { prepareErdBuildsFromContext, type ErdBuildResult } from "./export";
import { loadLocalErdSchema, type LocalErdSchemaContext } from "./local-schema";
import { initErdCommand } from "./utils";

const DEFAULT_ERD_BASE_DIR = ".tailor-sdk/erd";
const LOCAL_HOST = "127.0.0.1";

interface StaticServerResult {
  server: http.Server;
  url: string;
}

interface StartStaticServerOptions {
  distDir: string;
  port: number;
}

interface WatchOptions {
  configPath?: string;
  namespace?: string;
  outputDir: string;
  initialContext: LocalErdSchemaContext;
  initialResults: ErdBuildResult[];
}

interface FreshErdExportOptions {
  configPath?: string;
  namespace?: string;
  outputDir: string;
}

interface ErdExportJsonResult {
  namespace: string;
  distDir: string;
}

interface OpenStaticFileResult {
  filePath: string;
  fd: number;
}

const GLOB_CHARS = /[*?[\]{}()!+@]/;

function formatServeCommand(namespace: string): string {
  return `tailor-sdk tailordb erd serve --namespace ${namespace}`;
}

function getCacheControl(filePath: string): string {
  return filePath.endsWith(".html") || filePath.endsWith(".json")
    ? "no-cache"
    : "public, max-age=3600";
}

function resolveRequestPath(distDir: string, requestUrl: string | undefined): string | undefined {
  const url = new URL(requestUrl ?? "/", "http://localhost");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }

  if (pathname === "/" || pathname.endsWith("/")) {
    pathname = path.join(pathname, "index.html");
  }

  const root = path.resolve(distDir);
  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }
  return filePath;
}

function openStaticFile(filePath: string): OpenStaticFileResult | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    if (!fs.fstatSync(fd).isFile()) {
      fs.closeSync(fd);
      return undefined;
    }
    return { filePath, fd };
  } catch {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    return undefined;
  }
}

function serveFile(distDir: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const filePath = resolveRequestPath(distDir, req.url);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const fallbackPath = path.join(distDir, "index.html");
  const target = openStaticFile(filePath) ?? openStaticFile(fallbackPath);
  if (!target) {
    res.writeHead(503, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Retry-After": "1",
    });
    res.end("ERD build is refreshing. Please retry.");
    return;
  }

  const mimeType = lookupMime(target.filePath) || "application/octet-stream";
  const stream = fs.createReadStream(target.filePath, {
    fd: target.fd,
    autoClose: true,
  });
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(503, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "Retry-After": "1",
      });
      res.end("ERD build is refreshing. Please retry.");
      return;
    }
    res.destroy();
  });
  res.writeHead(200, {
    "Content-Type": mimeType,
    "Cache-Control": getCacheControl(target.filePath),
  });
  stream.pipe(res);
}

async function startStaticServer(options: StartStaticServerOptions): Promise<StaticServerResult> {
  const server = http.createServer((req, res) => {
    serveFile(options.distDir, req, res);
  });

  return await new Promise<StaticServerResult>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, LOCAL_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to determine ERD server address."));
        return;
      }
      resolve({
        server,
        url: `http://${LOCAL_HOST}:${address.port}`,
      });
    });
  });
}

function getWatchPatterns(config: LoadedConfig, results: ErdBuildResult[]): string[] {
  const namespaces = new Set(results.map((result) => result.namespace));
  const patterns = [config.path];
  for (const namespace of namespaces) {
    const dbConfig = config.db?.[namespace];
    if (dbConfig && !("external" in dbConfig)) {
      patterns.push(...dbConfig.files);
    }
  }
  return [...new Set(patterns)];
}

function hasGlobPattern(pattern: string): boolean {
  return GLOB_CHARS.test(pattern);
}

function globBaseDir(pattern: string): string {
  const absolutePattern = path.resolve(pattern);
  const parsed = path.parse(absolutePattern);
  const relativePattern = absolutePattern.slice(parsed.root.length);
  const literalParts: string[] = [];
  for (const part of relativePattern.split(path.sep)) {
    if (!part || GLOB_CHARS.test(part)) break;
    literalParts.push(part);
  }

  const literalPath =
    literalParts.length > 0 ? path.join(parsed.root, ...literalParts) : parsed.root;
  if (!literalPath || literalPath === parsed.root) return parsed.root || process.cwd();
  if (!fs.existsSync(literalPath)) return path.dirname(literalPath);
  return fs.statSync(literalPath).isDirectory() ? literalPath : path.dirname(literalPath);
}

async function expandWatchPattern(pattern: string): Promise<string[]> {
  if (!hasGlobPattern(pattern)) {
    return [path.resolve(pattern)];
  }

  const paths = new Set<string>();
  for await (const file of glob(pattern)) {
    paths.add(path.resolve(file));
  }

  const baseDir = globBaseDir(pattern);
  if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
    paths.add(baseDir);
  }
  return [...paths];
}

async function resolveWatchPathsFromConfig(
  config: LoadedConfig,
  results: ErdBuildResult[],
): Promise<string[]> {
  const paths = new Set<string>();
  for (const pattern of getWatchPatterns(config, results)) {
    for (const watchPath of await expandWatchPattern(pattern)) {
      paths.add(watchPath);
    }
  }
  return [...paths];
}

export async function resolveWatchPaths(
  context: LocalErdSchemaContext,
  results: ErdBuildResult[],
): Promise<string[]> {
  return await resolveWatchPathsFromConfig(context.config, results);
}

function parseFreshErdExportResults(stdout: string): ErdBuildResult[] {
  const lines = stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines.toReversed()) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!Array.isArray(parsed)) continue;
      return parsed.map((entry): ErdBuildResult => {
        const result = entry as Partial<ErdExportJsonResult>;
        if (typeof result.namespace !== "string" || typeof result.distDir !== "string") {
          throw new Error("Invalid ERD export JSON output.");
        }
        return {
          namespace: result.namespace,
          distDir: result.distDir,
        };
      });
    } catch {
      continue;
    }
  }
  throw new Error("Failed to parse ERD export JSON output.");
}

function freshErdExportArgs(options: FreshErdExportOptions): string[] {
  const cliEntry = process.argv[1];
  if (!cliEntry) {
    throw new Error("Cannot rebuild ERD schema in a fresh process: CLI entrypoint is unavailable.");
  }

  const args = [cliEntry, "tailordb", "erd", "export", "--output", options.outputDir, "--json"];
  if (options.configPath) {
    args.push("--config", options.configPath);
  }
  if (options.namespace) {
    args.push("--namespace", options.namespace);
  }
  return args;
}

async function runFreshErdExport(options: FreshErdExportOptions): Promise<ErdBuildResult[]> {
  return await new Promise<ErdBuildResult[]>((resolve, reject) => {
    const child = spawn(process.execPath, freshErdExportArgs(options), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const detail = stderr.trim() || signal || `exit code ${code}`;
        reject(new Error(`Fresh ERD export failed: ${detail}`));
        return;
      }
      try {
        resolve(parseFreshErdExportResults(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function selectPrimaryResult(results: ErdBuildResult[]): ErdBuildResult {
  const [primary, ...rest] = results;
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- index access may be undefined without noUncheckedIndexedAccess
  if (!primary) {
    throw new Error("No ERD build results found.");
  }

  logger.info(`Serving ERD for namespace "${primary.namespace}".`);
  if (rest.length > 0) {
    const commands = rest.map((result) => `  - ${formatServeCommand(result.namespace)}`).join("\n");
    logger.warn(`Multiple namespaces found. To serve another namespace, run:\n${commands}`);
  }

  return primary;
}

async function createErdWatcher(options: WatchOptions): Promise<FSWatcher> {
  let rebuilding = false;
  let pending = false;
  let watchPaths = await resolveWatchPaths(options.initialContext, options.initialResults);
  let importNonce = 0;

  const watcher = watch(watchPaths, {
    ignored: /node_modules/,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  async function rebuild(): Promise<void> {
    if (rebuilding) {
      pending = true;
      return;
    }

    rebuilding = true;
    try {
      const results = await runFreshErdExport({
        configPath: options.configPath,
        namespace: options.namespace,
        outputDir: options.outputDir,
      });
      const { config } = await loadConfig(options.configPath, {
        importNonce: String((importNonce += 1)),
      });
      const nextWatchPaths = await resolveWatchPathsFromConfig(config, results);
      watcher.unwatch(watchPaths);
      watcher.add(nextWatchPaths);
      watchPaths = nextWatchPaths;
      logger.success(
        `Rebuilt ERD schema (${results.map((result) => result.namespace).join(", ")})`,
        {
          mode: "stream",
        },
      );
    } catch (error) {
      logger.error("Failed to rebuild ERD schema. Serving the last successful build.", {
        mode: "stream",
      });
      logger.error(String(error));
    } finally {
      rebuilding = false;
      if (pending) {
        pending = false;
        await rebuild();
      }
    }
  }

  let debounceTimer: NodeJS.Timeout | undefined;
  const scheduleRebuild = (changedPath: string) => {
    logger.info(`Schema source changed: ${path.relative(process.cwd(), changedPath)}`, {
      mode: "stream",
    });
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      rebuild();
    }, 150);
  };

  watcher.on("add", scheduleRebuild);
  watcher.on("change", scheduleRebuild);
  watcher.on("unlink", scheduleRebuild);
  watcher.on("error", (error) => {
    logger.error(`ERD watcher error: ${String(error)}`, { mode: "stream" });
  });

  return watcher;
}

async function waitForShutdown(server: http.Server, watcher: FSWatcher): Promise<void> {
  return await new Promise<void>((resolve) => {
    const shutdown = () => {
      watcher.close().finally(() => {
        server.close(() => {
          logger.info("ERD server stopped.");
          resolve();
        });
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

export const erdServeCommand = defineAppCommand({
  name: "serve",
  description: "Generate and serve TailorDB ERD locally with watch reload. (beta)",
  args: z
    .object({
      ...configArg,
      namespace: arg(z.string().optional(), {
        alias: "n",
        description: "TailorDB namespace name (uses first namespace in config if not specified)",
      }),
      port: arg(z.coerce.number().int().min(0).max(65535).default(0), {
        description: "Local server port (0 selects a free port)",
      }),
      open: arg(z.boolean().default(false), {
        description: "Open the ERD viewer in the default browser",
      }),
    })
    .strict(),
  run: async (args) => {
    initErdCommand();

    const outputDir = path.resolve(process.cwd(), DEFAULT_ERD_BASE_DIR);
    const context = await loadLocalErdSchema({
      configPath: args.config,
      namespaces: args.namespace ? [args.namespace] : undefined,
    });
    const results = prepareErdBuildsFromContext({
      context,
      namespace: args.namespace,
      outputDir,
    });
    const primary = selectPrimaryResult(results);
    const { server, url } = await startStaticServer({
      distDir: primary.distDir,
      port: args.port,
    });
    const watchUrl = `${url}/?watch=1`;
    const watcher = await createErdWatcher({
      configPath: args.config,
      namespace: args.namespace,
      outputDir,
      initialContext: context,
      initialResults: results,
    });

    logger.newline();
    if (args.json) {
      logger.out({
        namespace: primary.namespace,
        url: watchUrl,
        distDir: primary.distDir,
      });
    } else {
      logger.success("ERD server started.");
      logger.out(watchUrl);
    }

    if (args.open) {
      try {
        await open(watchUrl);
      } catch {
        logger.warn("Failed to open browser automatically. Please open the URL above manually.");
      }
    }

    await waitForShutdown(server, watcher);
  },
});
