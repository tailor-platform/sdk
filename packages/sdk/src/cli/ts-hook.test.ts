import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { loadSync, resolveSync } from "./ts-hook.mjs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("const x: number = 1;"),
}));

vi.mock("amaro", () => ({
  transformSync: vi.fn().mockReturnValue({ code: "const x = 1;" }),
}));

describe("loadSync", () => {
  test("strips query string before fileURLToPath to avoid ERR_INVALID_FILE_URL_PATH", () => {
    const nextLoad = vi.fn();
    const result = loadSync("file:///path/to/foo.ts?tailorImportNonce=1", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("transforms a .mts URL that carries a hash fragment", () => {
    const nextLoad = vi.fn();
    const result = loadSync("file:///path/to/foo.mts#anchor", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("loads a .sql file as a query that rejects when run outside a function bundle", () => {
    const nextLoad = vi.fn();
    const result = loadSync("file:///path/to/query.sql?tailorImportNonce=1", {}, nextLoad);

    expect(nextLoad).not.toHaveBeenCalled();
    expect(result).toEqual({
      format: "module",
      shortCircuit: true,
      source: [
        `const message = ${JSON.stringify("/path/to/query.sql runs only in a deployed function or with `tailor function run`")};`,
        "export default { run: () => Promise.reject(new Error(message)) };",
        "",
      ].join("\n"),
    });
  });

  test("delegates non-file: URLs to nextLoad", () => {
    const nextLoad = vi.fn();
    loadSync("node:path", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("node:path", {});
  });

  test("delegates non-TS file URLs to nextLoad", () => {
    const nextLoad = vi.fn();
    loadSync("file:///path/to/foo.js", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.js", {});
  });

  test("delegates .d.ts declaration files to nextLoad without transforming", () => {
    const nextLoad = vi.fn();
    loadSync("file:///path/to/foo.d.ts", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.d.ts", {});
  });

  test("delegates .d.mts declaration files to nextLoad without transforming", () => {
    const nextLoad = vi.fn();
    loadSync("file:///path/to/foo.d.mts", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.d.mts", {});
  });
});

const notFound = (specifier: string) =>
  Object.assign(new Error(`Cannot find '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });

const dirImport = (specifier: string) =>
  Object.assign(new Error(`Directory import not allowed for '${specifier}'`), {
    code: "ERR_UNSUPPORTED_DIR_IMPORT",
  });

describe("resolveSync", () => {
  test("retries with /index.ts for ERR_UNSUPPORTED_DIR_IMPORT on relative directory specifier", () => {
    const resolved = { url: "file:///path/to/models/index.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw dirImport("./models");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync("./models", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./models/index.ts", {});
  });

  test("retries with .ts extension for extensionless relative specifier on ERR_MODULE_NOT_FOUND", () => {
    const resolved = { url: "file:///path/to/foo.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("./foo");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync("./foo", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./foo.ts", {});
  });

  test("retries with .ts extension for .js specifier on ERR_MODULE_NOT_FOUND", () => {
    const resolved = { url: "file:///path/to/foo.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("./foo.js");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync("./foo.js", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./foo.ts", {});
  });

  test("does not append extensions when specifier already has a TS extension", () => {
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("./foo.ts");
    });
    expect(() => resolveSync("./foo.ts", {}, nextResolve)).toThrow("Cannot find './foo.ts'");
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("retries with .ts extension for extensionless specifier whose basename contains a dot", () => {
    const resolved = { url: "file:///path/to/permissions.generated.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("./permissions.generated");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync("./permissions.generated", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./permissions.generated.ts", {});
  });

  test("rethrows ERR_MODULE_NOT_FOUND for non-relative specifiers without retrying", () => {
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("some-package");
    });
    expect(() => resolveSync("some-package", {}, nextResolve)).toThrow(
      "Cannot find 'some-package'",
    );
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("resolves non-relative specifier via tsconfig path alias", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///alias-sync-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("resolves tsconfig path alias when parentURL has tailorImportNonce query string", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce({ url: "file:///alias-sync-project/tailordb/user.ts" });
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-sync-project/tailor.config.ts?tailorImportNonce=1" },
      nextResolve,
    );
    expect(result).toEqual({
      url: "file:///alias-sync-project/tailordb/user.ts?tailorImportNonce=1",
    });
  });

  test("looks up tsconfig from the original importer's directory when nextResolve leaves a parentURL outside the project on the context", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith("/alias-mutated-sync-project/tsconfig.json", { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const nextResolve = vi
      .fn()
      .mockImplementationOnce((_specifier: string, context: { parentURL?: string }) => {
        context.parentURL = "file:///global-store/node_modules/x";
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce({ url: "file:///alias-mutated-sync-project/tailordb/user.ts" });
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-mutated-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual({ url: "file:///alias-mutated-sync-project/tailordb/user.ts" });
  });

  test("propagates the original importer's tailorImportNonce when nextResolve leaves a parentURL without it on the context", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const nextResolve = vi
      .fn()
      .mockImplementationOnce((_specifier: string, context: { parentURL?: string }) => {
        context.parentURL = "file:///alias-mutated-sync-project/node_modules/x";
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce({ url: "file:///alias-mutated-sync-project/tailordb/user.ts" });
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-mutated-sync-project/tailor.config.ts?tailorImportNonce=1" },
      nextResolve,
    );
    expect(result).toEqual({
      url: "file:///alias-mutated-sync-project/tailordb/user.ts?tailorImportNonce=1",
    });
  });

  test("resolves non-relative specifier via tsconfig path alias without baseUrl", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///alias-sync-project-no-baseurl/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-sync-project-no-baseurl/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("falls back to tsconfig directory when baseUrl is a non-string value", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: true, paths: { "@/*": ["./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///alias-sync-project-bad-baseurl/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-sync-project-bad-baseurl/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("ignores a paths alias whose target is not an array", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": "./*" } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("@/tailordb/user");
    });
    expect(() =>
      resolveSync(
        "@/tailordb/user",
        { parentURL: "file:///malformed-paths-sync-project/tailor.config.ts" },
        nextResolve,
      ),
    ).toThrow("Cannot find '@/tailordb/user'");
  });

  test("ignores non-string entries within a paths alias target array", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": [123, "./*"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///malformed-paths-entry-sync-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///malformed-paths-entry-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("collects paths from same-directory extends (visited key tracks file path, not dir)", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    const rootConfig = JSON.stringify({ extends: "./tsconfig.base.json" });
    using _tsconfigReads = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.base\.json$/), { encoding: "utf-8" })
      .thenReturn(baseConfig)
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(rootConfig);
    const resolved = { url: "file:///extends-sync-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///extends-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("resolves child paths using the extended config's baseUrl directory, not the child config's directory", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: "shared-base" },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: { "@app/*": ["./*"] } },
    });
    using _tsconfigReads = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.base\.json$/), { encoding: "utf-8" })
      .thenReturn(baseConfig)
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(rootConfig);
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("@app/tailordb/user");
    });
    expect(() =>
      resolveSync(
        "@app/tailordb/user",
        { parentURL: "file:///inherited-baseurl-sync-project/tailor.config.ts" },
        nextResolve,
      ),
    ).toThrow("Cannot find '@app/tailordb/user'");
    expect(nextResolve).toHaveBeenCalledWith(
      expect.stringContaining("inherited-baseurl-sync-project/shared-base/tailordb/user.ts"),
      expect.anything(),
    );
  });

  test("resolves inherited paths using the child's own baseUrl override, not the defining config's baseUrl", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: "parent-base", paths: { "@shared/*": ["./*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { baseUrl: "child-base" },
    });
    using _tsconfigReads = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.base\.json$/), { encoding: "utf-8" })
      .thenReturn(baseConfig)
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(rootConfig);
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("@shared/tailordb/user");
    });
    expect(() =>
      resolveSync(
        "@shared/tailordb/user",
        { parentURL: "file:///override-baseurl-sync-project/tailor.config.ts" },
        nextResolve,
      ),
    ).toThrow("Cannot find '@shared/tailordb/user'");
    expect(nextResolve).toHaveBeenCalledWith(
      expect.stringContaining("override-baseurl-sync-project/child-base/tailordb/user.ts"),
      expect.anything(),
    );
  });

  test("replaces inherited paths instead of merging when child config defines its own paths", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@parent/*": ["./parent-src/*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { baseUrl: ".", paths: { "@child/*": ["./child-src/*"] } },
    });
    using _tsconfigReads = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.base\.json$/), { encoding: "utf-8" })
      .thenReturn(baseConfig)
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(rootConfig);
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("@parent/foo");
    });
    expect(() =>
      resolveSync(
        "@parent/foo",
        { parentURL: "file:///replace-paths-sync-project/tailor.config.ts" },
        nextResolve,
      ),
    ).toThrow("Cannot find '@parent/foo'");
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("keeps inherited paths when child config's own paths is malformed", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@parent/*": ["./parent-src/*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: true },
    });
    using _tsconfigReads = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.base\.json$/), { encoding: "utf-8" })
      .thenReturn(baseConfig)
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(rootConfig);
    const resolved = { url: "file:///malformed-child-paths-sync-project/parent-src/foo.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@parent/foo");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@parent/foo",
      { parentURL: "file:///malformed-child-paths-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("prefers more specific wildcard alias over less specific", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@app/*": ["./*"], "@app/foo/*": ["./foo-pkg/*"] },
      },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///specificity-sync-project/foo-pkg/bar.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@app/foo/bar");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@app/foo/bar",
      { parentURL: "file:///specificity-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenLastCalledWith(
      expect.stringContaining("foo-pkg/bar"),
      expect.anything(),
    );
  });

  test("falls back to a less specific alias when a more specific alias's targets are all malformed", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@app/foo/*": [123], "@app/*": ["./*"] },
      },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///empty-target-fallback-sync-project/foo/bar.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@app/foo/bar");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@app/foo/bar",
      { parentURL: "file:///empty-target-fallback-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("does not append extensions when tsconfig path target already has a .ts extension", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/utils": ["./utils/index.ts"] } },
    });
    using _tsconfigRead = vi
      .when(vi.mocked(readFileSync))
      .calledWith(expect.stringMatching(/tsconfig\.json$/), { encoding: "utf-8" })
      .thenReturn(tsconfig);
    const resolved = { url: "file:///ext-sync-project/utils/index.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/utils");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/utils",
      { parentURL: "file:///ext-sync-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledTimes(2);
    expect(nextResolve).toHaveBeenLastCalledWith(
      expect.stringContaining("utils/index.ts"),
      expect.anything(),
    );
    expect(nextResolve).not.toHaveBeenCalledWith(
      expect.stringContaining("index.ts.ts"),
      expect.anything(),
    );
  });
});

describe("import nonce propagation", () => {
  const noncedParent = { parentURL: "file:///proj/workflows/approval.ts?tailorImportNonce=2" };

  test("carries the parent's nonce onto a relative resolution", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "file:///proj/workflows/points.ts" });
    const result = resolveSync("./points.ts", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/workflows/points.ts?tailorImportNonce=2" });
  });

  test("leaves the resolution alone when the parent has no nonce", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "file:///proj/workflows/points.ts" });
    const result = resolveSync(
      "./points.ts",
      { parentURL: "file:///proj/workflows/approval.ts" },
      nextResolve,
    );
    expect(result).toEqual({ url: "file:///proj/workflows/points.ts" });
  });

  test("carries the parent's nonce onto a file: URL specifier", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "file:///proj/workflows/points.ts" });
    const result = resolveSync("file:///proj/workflows/points.ts", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/workflows/points.ts?tailorImportNonce=2" });
  });

  test("carries the parent's nonce onto a package-imports specifier", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "file:///proj/lib/points.ts" });
    const result = resolveSync("#lib/points", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/lib/points.ts?tailorImportNonce=2" });
  });

  test("does not propagate onto a package-imports specifier resolving into node_modules", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "file:///proj/node_modules/dep/index.mjs" });
    const result = resolveSync("#dep", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/node_modules/dep/index.mjs" });
  });

  test("does not propagate onto bare specifiers", () => {
    const nextResolve = vi
      .fn()
      .mockReturnValue({ url: "file:///proj/packages/sdk/dist/index.mjs" });
    const result = resolveSync("@tailor-platform/sdk", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/packages/sdk/dist/index.mjs" });
  });

  test("does not propagate onto node_modules resolutions", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "file:///proj/node_modules/dep/index.mjs" });
    const result = resolveSync("../node_modules/dep/index.mjs", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/node_modules/dep/index.mjs" });
  });

  test("keeps an existing nonce on the resolved URL", () => {
    const nextResolve = vi
      .fn()
      .mockReturnValue({ url: "file:///proj/workflows/points.ts?tailorImportNonce=1" });
    const result = resolveSync("./points.ts", noncedParent, nextResolve);
    expect(result).toEqual({ url: "file:///proj/workflows/points.ts?tailorImportNonce=1" });
  });

  test("does not propagate onto non-file resolutions", () => {
    const nextResolve = vi.fn().mockReturnValue({ url: "node:path" });
    const result = resolveSync("./points.ts", noncedParent, nextResolve);
    expect(result).toEqual({ url: "node:path" });
  });

  test("re-reads tsconfig paths when the parent import nonce changes", () => {
    const tsconfigFor = (dir: string) =>
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@gen/*": [`./${dir}/*`] } } });
    const nextResolve = vi.fn().mockImplementation((spec: string) => {
      if (spec.startsWith("file:")) return { url: spec };
      throw notFound(spec);
    });

    vi.mocked(readFileSync).mockImplementation((path) =>
      String(path).endsWith("tsconfig.json") ? tsconfigFor("a") : "const x: number = 1;",
    );
    const first = resolveSync(
      "@gen/user",
      { parentURL: "file:///gen-project/tailor.config.ts?tailorImportNonce=1" },
      nextResolve,
    );
    expect(first).toEqual({ url: "file:///gen-project/a/user.ts?tailorImportNonce=1" });

    vi.mocked(readFileSync).mockImplementation((path) =>
      String(path).endsWith("tsconfig.json") ? tsconfigFor("b") : "const x: number = 1;",
    );
    const second = resolveSync(
      "@gen/user",
      { parentURL: "file:///gen-project/tailor.config.ts?tailorImportNonce=2" },
      nextResolve,
    );
    expect(second).toEqual({ url: "file:///gen-project/b/user.ts?tailorImportNonce=2" });
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;");
  });
});
