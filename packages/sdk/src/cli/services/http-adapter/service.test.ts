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

  it("rejects files containing multiple createHttpAdapter calls before importing them", async () => {
    const file = writeAdapter(
      "multi.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
// Importing a Node built-in would normally execute on dynamic import; the
// detector should reject this file before that happens.
import * as fs from "node:fs";
fs.readFileSync("/etc/passwd");

export const a = createHttpAdapter({
  name: "one",
  pathPattern: "/a",
  input: { get: () => ({ query: "{}" }) },
});

export default createHttpAdapter({
  name: "two",
  pathPattern: "/b",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(
      /Expected exactly one createHttpAdapter call per file/,
    );
  });

  it("rejects files whose name is not a static string literal", async () => {
    const file = writeAdapter(
      "dynamic-name.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
const dynamicName = "x";
export default createHttpAdapter({
  name: dynamicName,
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(/static string `name`/);
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
    await expect(service.loadAdapters()).rejects.toThrow(/`input\.get` must be synchronous/);
  });

  it("rejects files that call createHttpAdapter but forget to default-export it", async () => {
    const file = writeAdapter(
      "missing-default.ts",
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
// User forgot to add \`default\` here. Previously this was silently skipped,
// leaving the adapter unregistered with no diagnostic.
export const adapter = createHttpAdapter({
  name: "missing-default",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(/missing a `default` export/);
  });
});
