import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { bundleHttpAdapters } from "./bundler";

describe("bundleHttpAdapters", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("returns empty result when no adapters are provided", async () => {
    const result = await bundleHttpAdapters([]);
    expect(result.bundledInputs.size).toBe(0);
    expect(result.bundledOutputs.size).toBe(0);
  });

  it("bundles input and output scripts that assign globalThis.transform", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  methods: ["GET"],
  input: (req) => ({
    query: "query U($id: ID!) { user(id: $id) { id name } }",
    variables: { id: req.path.split("/")[2] },
  }),
  output: (resp) => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resp.data),
  }),
});
`,
    );

    const result = await bundleHttpAdapters([{ name: "get-user", sourceFile, hasOutput: true }]);

    const inputCode = result.bundledInputs.get("get-user");
    const outputCode = result.bundledOutputs.get("get-user");
    expect(inputCode).toBeDefined();
    expect(outputCode).toBeDefined();
    expect(inputCode).toContain("globalThis.transform");
    expect(outputCode).toContain("globalThis.transform");
  });

  it("rejects bundles that import Node built-in modules", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
import * as fs from "node:fs";

export default createHttpAdapter({
  name: "bad",
  pathPattern: "/bad",
  methods: ["GET"],
  input: () => {
    fs.readFileSync("/etc/passwd");
    return { query: "{}" };
  },
});
`,
    );

    await expect(
      bundleHttpAdapters([{ name: "bad", sourceFile, hasOutput: false }]),
    ).rejects.toThrow(/Node module/);
  });
});
