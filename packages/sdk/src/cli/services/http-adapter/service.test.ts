import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpAdapterService } from "./service";

describe("createHttpAdapterService.loadAdapters", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
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

  it("loads the default export and skips helper files matched by the glob", async () => {
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

    const service = createHttpAdapterService({ config: { files: [adapterFile, helperFile] } });
    await service.loadAdapters();

    expect(service.adapters).toHaveLength(1);
    expect(service.adapters[0].adapter.name).toBe("adapter");
  });

  it("accepts a computed (non-literal) name as long as it is valid at runtime", async () => {
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

    const service = createHttpAdapterService({ config: { files: [file] } });
    await service.loadAdapters();

    expect(service.adapters).toHaveLength(1);
    expect(service.adapters[0].adapter.name).toBe("dynamic-name");
  });

  it("allows handlers shared between methods via a local reference", async () => {
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

    const service = createHttpAdapterService({ config: { files: [file] } });
    await service.loadAdapters();

    expect(service.adapters).toHaveLength(1);
    expect(service.adapters[0].methods).toEqual(["get", "post"]);
  });

  it("rejects files whose input handler is async", async () => {
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

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(/async `input\.get` function/);
  });

  it("rejects files where the adapter is only a named export", async () => {
    const file = writeAdapter(
      "missing-default.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
// User forgot to default-export the adapter. Without this guard the adapter
// would be silently dropped from the deployment.
export const adapter = createHttpAdapter({
  name: "missing-default",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(/must be the default export/);
  });

  it("rejects plain objects that mimic the adapter shape without createHttpAdapter", async () => {
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

    const service = createHttpAdapterService({ config: { files: [file] } });
    await service.loadAdapters();

    // Not produced by createHttpAdapter -> treated as a non-adapter file.
    expect(service.adapters).toHaveLength(0);
  });
});
