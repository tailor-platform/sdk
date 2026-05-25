import * as fs from "node:fs";
import * as os from "node:os";
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
      tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-service-")));
    }
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, source);
    return file;
  }

  it("rejects files containing multiple defineHttpAdapter calls before importing them", async () => {
    const file = writeAdapter(
      "multi.ts",
      `
import { defineHttpAdapter } from "@tailor-platform/sdk";
// Importing a Node built-in would normally execute on dynamic import; the
// detector should reject this file before that happens.
import * as fs from "node:fs";
fs.readFileSync("/etc/passwd");

export const a = defineHttpAdapter({
  name: "one",
  pathPattern: "/a",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});

export default defineHttpAdapter({
  name: "two",
  pathPattern: "/b",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(
      /Expected exactly one defineHttpAdapter call per file/,
    );
  });

  it("rejects files whose name is not a static string literal", async () => {
    const file = writeAdapter(
      "dynamic-name.ts",
      `
import { defineHttpAdapter } from "@tailor-platform/sdk";
const dynamicName = "x";
export default defineHttpAdapter({
  name: dynamicName,
  pathPattern: "/x",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
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
import { defineHttpAdapter } from "@tailor-platform/sdk";
export default defineHttpAdapter({
  name: "async-input",
  pathPattern: "/x",
  methods: ["GET"],
  input: async () => ({ query: "{}" }),
});
`,
    );

    const service = createHttpAdapterService({ config: { files: [file] } });
    await expect(service.loadAdapters()).rejects.toThrow(/`input` must be synchronous/);
  });
});
