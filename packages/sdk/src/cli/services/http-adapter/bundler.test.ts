import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { bundleHttpAdapters } from "./bundler";

const nodeRequire = createRequire(import.meta.url);
const graphqlWebModule = nodeRequire.resolve("@0no-co/graphql.web");

describe("bundleHttpAdapters", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("returns empty result when no adapters are provided", async () => {
    const result = await bundleHttpAdapters([]);
    expect(result.bundledInputs.size).toBe(0);
    expect(result.bundledOutputs.size).toBe(0);
  });

  test("bundles input with a method dispatcher and output that assigns globalThis.transform", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";
import { parse } from ${JSON.stringify(graphqlWebModule)};

const getUserDocument = parse("query U($id: ID!) { user(id: $id) { id name } }");

export default createHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  input: {
    get: (req) => ({
      query: getUserDocument,
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

    const runtime: {
      transform?: (req: { method: string; path: string }) => {
        query: string;
        variables: { id: string | undefined };
      };
    } = {};
    new Function("globalThis", inputCode!).call(runtime, runtime);
    const request = runtime.transform!({ method: "GET", path: "/users/user-1" });
    expect(request.query).toContain("query U");
    expect(request.query).toContain("user(id: $id)");
    expect(request.variables.id).toBe("user-1");
  });

  test("dispatches to the matching method handler at runtime", async () => {
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

  test("passes through nullish input handler results", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "nullish",
  pathPattern: "/x",
  input: {
    get: () => null,
    post: () => undefined,
  },
});
`,
    );

    const result = await bundleHttpAdapters([
      { name: "nullish", sourceFile, methods: ["get", "post"], hasOutput: false },
    ]);

    const inputCode = result.bundledInputs.get("nullish");
    expect(inputCode).toBeDefined();

    const runtime: { transform?: (req: { method: string }) => unknown } = {};
    new Function("globalThis", inputCode!).call(runtime, runtime);
    expect(runtime.transform!({ method: "GET" })).toBeNull();
    expect(runtime.transform!({ method: "POST" })).toBeUndefined();
  });

  test("drops console calls below the configured log level", async () => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "http-adapter-bundle-")));
    const sourceFile = path.join(tmpDir, "adapter.ts");
    fs.writeFileSync(
      sourceFile,
      `
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "logs",
  pathPattern: "/logs",
  input: {
    get: () => {
      console.debug("input debug");
      console.log("input log");
      console.info("input info");
      console.warn("input warn");
      console.error("input error");
      return { query: "{}" };
    },
  },
  output: () => {
    console.debug("output debug");
    console.log("output log");
    console.info("output info");
    console.warn("output warn");
    console.error("output error");
    return { statusCode: 200 };
  },
});
`,
    );

    const result = await bundleHttpAdapters(
      [{ name: "logs", sourceFile, methods: ["get"], hasOutput: true }],
      undefined,
      "WARN",
    );

    const inputCode = result.bundledInputs.get("logs");
    const outputCode = result.bundledOutputs.get("logs");
    expect(inputCode).toBeDefined();
    expect(outputCode).toBeDefined();
    expect(inputCode).not.toContain("console.debug");
    expect(inputCode).not.toContain("console.log");
    expect(inputCode).not.toContain("console.info");
    expect(inputCode).toContain("console.warn");
    expect(inputCode).toContain("console.error");
    expect(outputCode).not.toContain("console.debug");
    expect(outputCode).not.toContain("console.log");
    expect(outputCode).not.toContain("console.info");
    expect(outputCode).toContain("console.warn");
    expect(outputCode).toContain("console.error");
  });

  test("rejects bundles that import Node built-in modules", async () => {
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

  test("rejects bundles where an imported helper introduces async/await", async () => {
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
