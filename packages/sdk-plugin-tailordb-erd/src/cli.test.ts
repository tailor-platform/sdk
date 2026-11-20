import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { describe, expect, onTestFinished, test } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cliEntry = path.join(packageRoot, "bin/cli.mjs");
const CLI_TEST_TIMEOUT_MS = 15_000;
const missingConfigPath = fileURLToPath(new URL("__fixtures__/missing.config.ts", import.meta.url));
const serveConfigPath = fileURLToPath(
  new URL("__fixtures__/serve/tailor.config.ts", import.meta.url),
);

function assertBuilt() {
  if (!existsSync(path.join(packageRoot, "dist/cli.js"))) {
    throw new Error(
      "packages/sdk-plugin-tailordb-erd is not built. Run `pnpm --filter @tailor-platform/sdk-plugin-tailordb-erd build` first.",
    );
  }
}

function runCli(args: string[]) {
  assertBuilt();
  return spawnSync(process.execPath, [cliEntry, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH, FORCE_COLOR: "0" },
  });
}

function parseErrorEnvelope(stderr: string): unknown {
  const envelope = stderr.trim().split(/\r?\n/).at(-1);
  expect(envelope).toBeDefined();
  return JSON.parse(envelope ?? "");
}

function throwingConfig(thrown = 'new Error("config is broken")') {
  const dir = mkdtempSync(path.join(tmpdir(), "erd-throwing-config-"));
  const configPath = path.join(dir, "tailor.config.ts");
  writeFileSync(configPath, `throw ${thrown};\n`);
  return { configPath, [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("tailordb-erd CLI JSON errors", () => {
  test(
    "serializes a missing configuration error",
    () => {
      expect(existsSync(missingConfigPath)).toBe(false);

      const result = runCli(["export", "--json", "--config", missingConfigPath]);

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(parseErrorEnvelope(result.stderr)).toEqual({
        error: {
          code: "CONFIG_NOT_FOUND",
          message: `Configuration file not found: ${path.resolve(missingConfigPath)}`,
          suggestion: "Check the path given with --config or TAILOR_CONFIG_PATH.",
          context: { file: path.resolve(missingConfigPath) },
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "reads the config path from an --env-file",
    () => {
      const result = runCli(["export", "--json", "-e", "src/__fixtures__/missing-config.env"]);

      expect(result.status).toBe(1);
      expect(parseErrorEnvelope(result.stderr)).toMatchObject({
        error: {
          code: "CONFIG_NOT_FOUND",
          message: "Configuration file not found: src/__fixtures__/missing.config.ts",
        },
      });
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "includes a stack trace in verbose JSON errors",
    () => {
      using tmp = throwingConfig();

      const result = runCli(["export", "--json", "--verbose", "--config", tmp.configPath]);
      const envelope = parseErrorEnvelope(result.stderr) as {
        error: { code: string; message: string; stack?: string };
      };

      expect(result.status).toBe(1);
      expect(envelope.error.stack).toContain("Error: config is broken");
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "puts the file a failure points at before its message",
    () => {
      using tmp = throwingConfig();

      const result = runCli(["export", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `${path.relative(packageRoot, tmp.configPath)}: config is broken`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "puts the file before the message of a failure whose format() does not return a string",
    () => {
      using tmp = throwingConfig(
        'Object.assign(new Error("config is broken"), { format: () => ({ _errors: [] }) })',
      );

      const result = runCli(["export", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `✖ ${path.relative(packageRoot, tmp.configPath)}: config is broken`,
      );
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "prints a self-formatted failure's report unchanged",
    () => {
      using tmp = throwingConfig(
        'Object.assign(new Error("config is broken"), { format: () => "custom report" })',
      );

      const result = runCli(["export", "--config", tmp.configPath]);

      expect(result.status).toBe(1);
      expect(result.stderr.trim().split(/\r?\n/).at(-1)).toBe("custom report");
    },
    CLI_TEST_TIMEOUT_MS,
  );
});

interface ServeProcess {
  child: ChildProcess;
  url: URL;
  closed: Promise<number | null>;
  stderr: () => string;
}

async function startServe(): Promise<ServeProcess> {
  assertBuilt();
  const cwd = mkdtempSync(path.join(tmpdir(), "erd-serve-"));
  const child = spawn(
    process.execPath,
    [cliEntry, "serve", "--config", serveConfigPath, "--port", "0"],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, FORCE_COLOR: "0" },
    },
  );
  onTestFinished(() => {
    child.kill("SIGKILL");
    rmSync(cwd, { recursive: true, force: true });
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => (stderr += chunk));
  const closed = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
  });
  const url = await new Promise<URL>((resolve, reject) => {
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const match = /http:\/\/\S+\?watch=1/.exec(stdout);
      if (match) resolve(new URL(match[0]));
    });
    void closed.then(() => reject(new Error(`serve exited before printing its URL\n${stderr}`)));
  });
  return { child, url, closed, stderr: () => stderr };
}

describe("tailordb-erd serve", () => {
  test.each(["SIGINT", "SIGTERM"] as const)(
    "stops the server and exits 0 on %s",
    async (signal) => {
      const serve = await startServe();

      serve.child.kill(signal);

      expect(await serve.closed).toBe(0);
      expect(serve.stderr()).toContain("ERD server stopped.");
      expect(serve.stderr()).not.toContain("Process interrupted");
    },
    CLI_TEST_TIMEOUT_MS,
  );

  test(
    "stops while a request is still being received",
    async () => {
      const serve = await startServe();
      const socket = connect(Number(serve.url.port), serve.url.hostname);
      onTestFinished(() => {
        socket.destroy();
      });
      socket.on("error", () => {});
      await new Promise<void>((resolve) => socket.once("connect", resolve));
      socket.write(`GET / HTTP/1.1\r\nHost: ${serve.url.host}\r\n`);
      await new Promise((resolve) => setTimeout(resolve, 200));

      serve.child.kill("SIGINT");

      const stopped = await Promise.race([
        serve.closed,
        new Promise((resolve) => setTimeout(() => resolve("still running"), 5_000)),
      ]);
      expect(stopped).toBe(0);
      expect(serve.stderr()).toContain("ERD server stopped.");
    },
    CLI_TEST_TIMEOUT_MS,
  );
});
