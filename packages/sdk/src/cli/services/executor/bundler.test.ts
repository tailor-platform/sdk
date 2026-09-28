import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { bundleExecutors } from "./bundler";

function writeBufferEncodingPackage(projectDir: string, name: string): void {
  const packageDir = path.join(projectDir, "node_modules", name);
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name, type: "module", exports: { ".": "./index.js" } }),
  );
  fs.writeFileSync(
    path.join(packageDir, "index.js"),
    'export const encode = (text) => Buffer.from(text).toString("base64");\n',
  );
}

function writeEncodingExecutor(projectDir: string, packageName: string): void {
  const executorDir = path.join(projectDir, "src/backend/pkgglobal/executor");
  fs.mkdirSync(executorDir, { recursive: true });
  fs.writeFileSync(
    path.join(executorDir, "encoder.ts"),
    `import { encode } from "${packageName}";\n` +
      `export default {\n` +
      `  name: "encoder",\n` +
      `  trigger: { kind: "schedule", cron: "0 12 * * *" },\n` +
      `  operation: { kind: "function", body: async () => { console.log(encode("hi")); } },\n` +
      `};\n`,
  );
}

describe("bundleExecutors", () => {
  test("does not throw when no executor files match", async () => {
    using tmp = tempCwd("sdk-bundler-");
    fs.mkdirSync(path.join(tmp.dir, "src/backend/provisioning/executor"), {
      recursive: true,
    });

    await expect(
      bundleExecutors({
        config: {
          files: ["./src/backend/provisioning/executor/*.ts"],
        },
        baseDir: tmp.dir,
      }),
    ).resolves.toEqual(new Map());
  });

  test("rejects an executor that references process.env", async () => {
    using tmp = tempCwd("sdk-bundler-executor-forbidden-global-");
    const executorDir = path.join(tmp.dir, "src/backend/nodeglobal/executor");
    fs.mkdirSync(executorDir, { recursive: true });
    fs.writeFileSync(
      path.join(executorDir, "leaky.ts"),
      `export default {\n` +
        `  name: "leaky",\n` +
        `  trigger: { kind: "schedule", cron: "0 12 * * *" },\n` +
        `  operation: {\n` +
        `    kind: "function",\n` +
        `    body: async () => {\n` +
        `      if (process.env.SOME_FLAG === "1") return;\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
    );

    await expect(
      bundleExecutors({
        config: { files: ["./src/backend/nodeglobal/executor/*.ts"] },
        baseDir: tmp.dir,
      }),
    ).rejects.toThrow(/references a global unavailable in the Tailor Platform runtime: process/);
  });

  test("warns instead of failing when only an installed package references a forbidden global", async () => {
    using tmp = tempCwd("sdk-bundler-executor-package-global-");
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeBufferEncodingPackage(tmp.dir, "executor-buffer-lib");
    writeEncodingExecutor(tmp.dir, "executor-buffer-lib");

    const result = await bundleExecutors({
      config: { files: ["./src/backend/pkgglobal/executor/*.ts"] },
      baseDir: tmp.dir,
    });

    expect(result.get("encoder")).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("executor-buffer-lib"));
  });

  test("does not warn about a global the installed package is allowed to reference", async () => {
    using tmp = tempCwd("sdk-bundler-executor-allowed-package-global-");
    using warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    writeBufferEncodingPackage(tmp.dir, "executor-allowed-buffer-lib");
    writeEncodingExecutor(tmp.dir, "executor-allowed-buffer-lib");

    await bundleExecutors({
      config: { files: ["./src/backend/pkgglobal/executor/*.ts"] },
      baseDir: tmp.dir,
      allowedRuntimeGlobals: { "executor-allowed-buffer-lib": ["Buffer"] },
    });

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("executor-allowed-buffer-lib"),
    );
  });

  test("bundles an executor that uses Web Standard globals", async () => {
    using tmp = tempCwd("sdk-bundler-executor-web-standard-");
    const executorDir = path.join(tmp.dir, "src/backend/webstandard/executor");
    fs.mkdirSync(executorDir, { recursive: true });
    fs.writeFileSync(
      path.join(executorDir, "fetcher.ts"),
      `export default {\n` +
        `  name: "fetcher",\n` +
        `  trigger: { kind: "schedule", cron: "0 12 * * *" },\n` +
        `  operation: {\n` +
        `    kind: "function",\n` +
        `    body: async () => {\n` +
        `      await fetch(new URL("https://example.com"));\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
    );

    const result = await bundleExecutors({
      config: { files: ["./src/backend/webstandard/executor/*.ts"] },
      baseDir: tmp.dir,
    });

    expect(result.get("fetcher")).toBeDefined();
  });
});
