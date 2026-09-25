import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test } from "vitest";
import { createExecutorService } from "./service";

describe("createExecutorService.loadExecutors", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeExecutor(name: string, source: string): string {
    if (!tmpDir) {
      // Place fixtures inside the SDK package so dynamic `import()` can resolve
      // `@tailor-platform/sdk` via the workspace node_modules tree. os.tmpdir()
      // would put them outside the workspace and break module resolution for
      // tests that exercise the actual import path.
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(import.meta.dirname, ".executor-service-")),
      );
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  function executorSource(name: string): string {
    return `
import { createExecutor, incomingWebhookTrigger } from "@tailor-platform/sdk";
export default createExecutor({
  name: "${name}",
  trigger: incomingWebhookTrigger({
    response: () => ({}),
  }),
  operation: {
    kind: "function",
    body: () => {},
  },
});
`;
  }

  test("loads executors with distinct names", async () => {
    const fileA = writeExecutor("a.ts", executorSource("executor-a"));
    const fileB = writeExecutor("b.ts", executorSource("executor-b"));

    const service = createExecutorService({
      config: { files: [fileA, fileB] },
      baseDir: process.cwd(),
    });
    await service.loadExecutors();

    expect(
      Object.values(service.executors)
        .map((e) => e.name)
        .toSorted(),
    ).toEqual(["executor-a", "executor-b"]);
  });

  test("rejects two files declaring the same executor name", async () => {
    const fileA = writeExecutor("a.ts", executorSource("duplicate"));
    const fileB = writeExecutor("b.ts", executorSource("duplicate"));

    const service = createExecutorService({
      config: { files: [fileA, fileB] },
      baseDir: process.cwd(),
    });

    await expect(service.loadExecutors()).rejects.toThrow(/Duplicate executor name "duplicate"/);
  });

  test("exposes plugin executors to later loadExecutors() calls in a plugin-only configuration", async () => {
    const pluginFile = writeExecutor("plugin.ts", executorSource("plugin-executor"));

    const service = createExecutorService({ config: { files: [] }, baseDir: process.cwd() });
    // Deployment planning calls loadExecutors() again after the application
    // has loaded plugin-generated executor files; the plugin executor must be
    // visible in that second result or the plan omits it.
    await expect(service.loadExecutors()).resolves.toBeUndefined();
    await service.loadPluginExecutorFiles([pluginFile]);

    const executors = await service.loadExecutors();
    expect(Object.values(executors ?? {}).map((e) => e.name)).toEqual(["plugin-executor"]);
  });

  test("rejects a plugin-generated executor whose name collides with a user-defined one", async () => {
    const fileA = writeExecutor("a.ts", executorSource("shared-name"));
    const pluginFile = writeExecutor("plugin.ts", executorSource("shared-name"));

    const service = createExecutorService({ config: { files: [fileA] }, baseDir: process.cwd() });
    await service.loadExecutors();

    await expect(service.loadPluginExecutorFiles([pluginFile])).rejects.toThrow(
      /Duplicate executor name "shared-name"/,
    );
  });
});
