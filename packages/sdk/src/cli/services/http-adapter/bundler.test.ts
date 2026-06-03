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

  it("bundles input with a method dispatcher and output that assigns globalThis.transform", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  input: {
    get: (req) => ({
      query: "query U($id: ID!) { user(id: $id) { id name } }",
      variables: { id: req.path.split("/")[2] },
    }),
  },
  output: (resp) => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resp.data),
  }),
});
`,
    );

    const result = await bundleHttpAdapters([
      { name: "get-user", sourceFile, methods: ["get"], hasOutput: true },
    ]);

    const inputCode = result.bundledInputs.get("get-user");
    const outputCode = result.bundledOutputs.get("get-user");
    expect(inputCode).toBeDefined();
    expect(outputCode).toBeDefined();
    expect(inputCode).toContain("globalThis.transform");
    // Dispatcher should reference the GET branch (rolldown minify may use
    // either double quotes or backticks for the case literal).
    expect(inputCode).toMatch(/case\s*[`"]GET[`"]/);
    expect(outputCode).toContain("globalThis.transform");
  });

  it("dispatches to the matching method handler at runtime", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "multi",
  pathPattern: "/x",
  input: {
    get:    () => ({ query: "GET" }),
    post:   () => ({ query: "POST" }),
    delete: () => ({ query: "DELETE" }),
  },
});
`,
    );

    const result = await bundleHttpAdapters([
      { name: "multi", sourceFile, methods: ["get", "post", "delete"], hasOutput: false },
    ]);

    const inputCode = result.bundledInputs.get("multi");
    expect(inputCode).toBeDefined();

    // Execute the bundled IIFE in a tiny sandbox to verify dispatch.
    const runtime: { transform?: (req: { method: string }) => { query: string } } = {};
    new Function("globalThis", inputCode!).call(runtime, runtime);
    expect(runtime.transform).toBeDefined();
    expect(runtime.transform!({ method: "GET" }).query).toBe("GET");
    expect(runtime.transform!({ method: "POST" }).query).toBe("POST");
    expect(runtime.transform!({ method: "DELETE" }).query).toBe("DELETE");
    expect(() => runtime.transform!({ method: "PUT" })).toThrow(
      /unsupported method: PUT.*GET, POST, DELETE/,
    );
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
  input: {
    get: () => {
      fs.readFileSync("/etc/passwd");
      return { query: "{}" };
    },
  },
});
`,
    );

    await expect(
      bundleHttpAdapters([{ name: "bad", sourceFile, methods: ["get"], hasOutput: false }]),
    ).rejects.toThrow(/Node module/);
  });

  it("rejects bundles where an imported helper introduces async/await", async () => {
    // The handler itself is synchronous, but it calls a helper from a sibling
    // module which is async. Detector-side checks only see the top-level
    // handler — without the post-bundle scan, this would slip through.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    const helperFile = path.join(tmpDir, "helper.ts");
    fs.writeFileSync(
      helperFile,
      `export async function buildQuery() { return "{ me { id } }"; }\n`,
    );
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
import { buildQuery } from "./helper";

export default createHttpAdapter({
  name: "async-helper",
  pathPattern: "/x",
  input: {
    get: (req) => ({ query: buildQuery(), variables: { req } }),
  },
});
`,
    );

    await expect(
      bundleHttpAdapters([
        { name: "async-helper", sourceFile, methods: ["get"], hasOutput: false },
      ]),
    ).rejects.toThrow(/async\/await, which is unavailable/);
  });
});
