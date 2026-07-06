import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { createExecutorService } from "./service";

describe("createExecutorService.loadExecutors", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
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

    const service = createExecutorService({ config: { files: [fileA, fileB] } });
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

    const service = createExecutorService({ config: { files: [fileA, fileB] } });

    await expect(service.loadExecutors()).rejects.toThrow(/Duplicate executor name "duplicate"/);
  });

  test("rejects a plugin-generated executor whose name collides with a user-defined one", async () => {
    const fileA = writeExecutor("a.ts", executorSource("shared-name"));
    const pluginFile = writeExecutor("plugin.ts", executorSource("shared-name"));

    const service = createExecutorService({ config: { files: [fileA] } });
    await service.loadExecutors();

    await expect(service.loadPluginExecutorFiles([pluginFile])).rejects.toThrow(
      /Duplicate executor name "shared-name"/,
    );
  });
});
