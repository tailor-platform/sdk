import * as fs from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { getErrorDiagnostics } from "#/cli/shared/error-diagnostics";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { createHttpAdapterService } from "./service";

describe("createHttpAdapterService.loadAdapters", () => {
  let tmpDir: string | undefined;

  aroundEach(async (runTest) => {
    await runTest();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  function writeAdapter(name: string, source: string): string {
    if (!tmpDir) {
      // Place fixtures inside the SDK package so dynamic `import()` can resolve
      // `@tailor-platform/sdk` via the workspace node_modules tree. os.tmpdir()
      // would put them outside the workspace and break module resolution for
      // tests that exercise the actual import path.
      tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(import.meta.dirname, ".http-adapter-service-")),
      );
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  test("loads the default export and skips helper files matched by the glob", async () => {
    const adapterFile = writeAdapter(
      "adapter.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "adapter",
  pathPattern: "/a",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );
    const helperFile = writeAdapter(
      "helper.ts",
      `
export const shared = (value: string) => value.toUpperCase();
`,
    );

    const service = createHttpAdapterService({
      config: { files: [adapterFile, helperFile] },
      baseDir: process.cwd(),
    });
    await service.loadAdapters();

    expect(service.adapters).toHaveLength(1);
    expect(service.adapters[0]!.adapter.name).toBe("adapter");
  });

  test("rejects two files declaring the same adapter name", async () => {
    const source = `
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "duplicate",
  pathPattern: "/a",
  input: { get: () => ({ query: "{}" }) },
});
`;
    const fileA = writeAdapter("a.ts", source);
    const fileB = writeAdapter("b.ts", source);

    const service = createHttpAdapterService({
      config: { files: [fileA, fileB] },
      baseDir: process.cwd(),
    });

    await expect(service.loadAdapters()).rejects.toMatchObject({
      code: "DEFINITION_NAME_DUPLICATE",
      context: {
        kind: "http-adapter",
        duplicates: [
          {
            name: "duplicate",
            definitions: [
              { file: fileA, exportName: "default" },
              { file: fileB, exportName: "default" },
            ],
          },
        ],
      },
    });
  });

  test("accepts a computed (non-literal) name as long as it is valid at runtime", async () => {
    const file = writeAdapter(
      "dynamic-name.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
const dynamicName = ["dynamic", "name"].join("-");
export default createHttpAdapter({
  name: dynamicName,
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    await service.loadAdapters();

    expect(service.adapters).toHaveLength(1);
    expect(service.adapters[0]!.adapter.name).toBe("dynamic-name");
  });

  test("allows handlers shared between methods via a local reference", async () => {
    const file = writeAdapter(
      "shared-handler.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
const handler = () => ({ query: "{}" });
export default createHttpAdapter({
  name: "shared-handler",
  pathPattern: "/x",
  input: { get: handler, post: handler },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    await service.loadAdapters();

    expect(service.adapters).toHaveLength(1);
    expect(service.adapters[0]!.methods).toEqual(["get", "post"]);
  });

  test("rejects files whose input handler is async", async () => {
    const file = writeAdapter(
      "async-input.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "async-input",
  pathPattern: "/x",
  input: { get: async () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    const rejection = await service.loadAdapters().catch((error: unknown) => error);
    expect(rejection).toMatchObject({
      code: "HTTP_ADAPTER_ASYNC_UNSUPPORTED",
      message: 'HTTP adapter "async-input" has an async `input.get` function.',
      suggestion: "Make the handler synchronous; async/await is not supported.",
      context: { name: "async-input", kind: "input.get" },
    });
    expect(getErrorDiagnostics(rejection as Error).location).toEqual({ file });
  });

  test("rejects files whose output handler is async", async () => {
    const file = writeAdapter(
      "async-output.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "async-output",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
  output: async () => ({ status: 200 }),
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    await expect(service.loadAdapters()).rejects.toMatchObject({
      code: "HTTP_ADAPTER_ASYNC_UNSUPPORTED",
      message: 'HTTP adapter "async-output" has an async `output` function.',
      context: { name: "async-output", kind: "output" },
    });
  });

  test("rejects files where the adapter is only a named export", async () => {
    const file = writeAdapter(
      "missing-default.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
export const adapter = createHttpAdapter({
  name: "missing-default",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    using _logger = silenceLogger("error");
    await expect(service.loadAdapters()).rejects.toMatchObject({
      code: "DEFINITION_EXPORT_INVALID",
      message: expect.stringMatching(
        /^HTTP adapter must not be a named export, but it is exported as `adapter`\.$/,
      ),
      context: { kind: "http-adapter", file, exportName: "adapter" },
    });
  });

  test("reports an adapter that fails validation as DEFINITION_INVALID", async () => {
    const file = writeAdapter(
      "invalid.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
const adapter = createHttpAdapter({
  name: "invalid",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
adapter.pathPattern = 1;
export default adapter;
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    using _logger = silenceLogger("error");
    await expect(service.loadAdapters()).rejects.toMatchObject({
      code: "DEFINITION_INVALID",
      message: expect.stringMatching(/^Invalid HTTP adapter:\n {2}- pathPattern: /),
      context: {
        kind: "http-adapter",
        file,
        exportName: "default",
        issues: [{ path: ["pathPattern"] }],
      },
    });
    expect(vi.mocked(logger.error).mock.calls).toEqual([
      [expect.stringMatching(/Failed to load HTTP adapter from.*invalid\.ts/)],
    ]);
  });

  test("reports an adapter name the platform rejects", async () => {
    const file = writeAdapter(
      "invalid-name.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "My_Adapter",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    using _logger = silenceLogger("error");
    await expect(service.loadAdapters()).rejects.toMatchObject({
      code: "DEFINITION_INVALID",
      context: {
        issues: [
          {
            path: ["name"],
            message:
              "must be 3-63 lowercase letters, digits, or hyphens, starting and ending with a letter or digit",
          },
        ],
      },
    });
  });

  test("rejects plain objects that mimic the adapter shape without createHttpAdapter", async () => {
    const file = writeAdapter(
      "unbranded.ts",
      `
export default {
  name: "unbranded",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
};
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] }, baseDir: process.cwd() });
    await service.loadAdapters();

    // Not produced by createHttpAdapter -> treated as a non-adapter file.
    expect(service.adapters).toHaveLength(0);
  });
});
