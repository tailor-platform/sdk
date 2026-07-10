import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { load, loadSync, resolve, resolveSync } from "./ts-hook.mjs";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("const x: number = 1;"),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("const x: number = 1;"),
}));

vi.mock("amaro", () => ({
  transformSync: vi.fn().mockReturnValue({ code: "const x = 1;" }),
}));

describe("load", () => {
  test("strips query string before fileURLToPath to avoid ERR_INVALID_FILE_URL_PATH", async () => {
    const nextLoad = vi.fn();
    const result = await load("file:///path/to/foo.ts?tailorImportNonce=1", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("strips hash before fileURLToPath", async () => {
    const nextLoad = vi.fn();
    const result = await load("file:///path/to/foo.mts#anchor", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
  });

  test("delegates non-file: URLs to nextLoad", async () => {
    const nextLoad = vi.fn();
    await load("node:path", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("node:path", {});
  });

  test("delegates non-TS file URLs to nextLoad", async () => {
    const nextLoad = vi.fn();
    await load("file:///path/to/foo.js", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.js", {});
  });

  test("delegates .d.ts declaration files to nextLoad without transforming", async () => {
    const nextLoad = vi.fn();
    await load("file:///path/to/foo.d.ts", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.d.ts", {});
  });

  test("delegates .d.mts declaration files to nextLoad without transforming", async () => {
    const nextLoad = vi.fn();
    await load("file:///path/to/foo.d.mts", {}, nextLoad);
    expect(nextLoad).toHaveBeenCalledWith("file:///path/to/foo.d.mts", {});
  });
});

describe("loadSync", () => {
  test("strips query string before fileURLToPath to avoid ERR_INVALID_FILE_URL_PATH", () => {
    const nextLoad = vi.fn();
    const result = loadSync("file:///path/to/foo.ts?tailorImportNonce=1", {}, nextLoad);
    expect(result).toMatchObject({ format: "module", shortCircuit: true });
    expect(nextLoad).not.toHaveBeenCalled();
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
});

const notFound = (specifier: string) =>
  Object.assign(new Error(`Cannot find '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });

const dirImport = (specifier: string) =>
  Object.assign(new Error(`Directory import not allowed for '${specifier}'`), {
    code: "ERR_UNSUPPORTED_DIR_IMPORT",
  });

describe("resolve", () => {
  test("retries with /index.ts for ERR_UNSUPPORTED_DIR_IMPORT on relative directory specifier", async () => {
    const resolved = { url: "file:///path/to/models/index.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(dirImport("./models"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve("./models", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./models/index.ts", {});
  });

  test("retries with .ts extension for extensionless relative specifier on ERR_MODULE_NOT_FOUND", async () => {
    const resolved = { url: "file:///path/to/foo.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("./foo"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve("./foo", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./foo.ts", {});
  });

  test("retries with .ts extension for .js specifier on ERR_MODULE_NOT_FOUND", async () => {
    const resolved = { url: "file:///path/to/foo.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("./foo.js"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve("./foo.js", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./foo.ts", {});
  });

  test("does not append extensions when specifier already has a TS extension", async () => {
    const nextResolve = vi.fn().mockRejectedValue(notFound("./foo.ts"));
    await expect(resolve("./foo.ts", {}, nextResolve)).rejects.toMatchObject({
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("retries with .ts extension for extensionless specifier whose basename contains a dot", async () => {
    const resolved = { url: "file:///path/to/permissions.generated.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("./permissions.generated"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve("./permissions.generated", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenCalledWith("./permissions.generated.ts", {});
  });

  test("rethrows ERR_MODULE_NOT_FOUND for non-relative specifiers without retrying", async () => {
    const nextResolve = vi.fn().mockRejectedValue(notFound("some-package"));
    await expect(resolve("some-package", {}, nextResolve)).rejects.toMatchObject({
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("resolves non-relative specifier via tsconfig path alias", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///alias-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/tailordb/user"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/tailordb/user",
      { parentURL: "file:///alias-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves non-relative specifier via tsconfig path alias without baseUrl", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///alias-project-no-baseurl/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/tailordb/user"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/tailordb/user",
      { parentURL: "file:///alias-project-no-baseurl/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("falls back to tsconfig directory when baseUrl is a non-string value", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: true, paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///alias-project-bad-baseurl/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/tailordb/user"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/tailordb/user",
      { parentURL: "file:///alias-project-bad-baseurl/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("ignores a paths alias whose target is not an array", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": "./*" } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const nextResolve = vi.fn().mockRejectedValue(notFound("@/tailordb/user"));
    await expect(
      resolve(
        "@/tailordb/user",
        { parentURL: "file:///malformed-paths-project/tailor.config.ts" },
        nextResolve,
      ),
    ).rejects.toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("ignores non-string entries within a paths alias target array", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": [123, "./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///malformed-paths-entry-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/tailordb/user"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/tailordb/user",
      { parentURL: "file:///malformed-paths-entry-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves tsconfig path alias when parentURL has tailorImportNonce query string", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///alias-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/tailordb/user"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/tailordb/user",
      { parentURL: "file:///alias-project/tailor.config.ts?tailorImportNonce=1" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("collects paths from same-directory extends (visited key tracks file path, not dir)", async () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    const rootConfig = JSON.stringify({ extends: "./tsconfig.base.json" });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///extends-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/tailordb/user"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/tailordb/user",
      { parentURL: "file:///extends-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves child paths using the extended config's baseUrl directory, not the child config's directory", async () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: "shared-base" },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: { "@app/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const nextResolve = vi.fn().mockRejectedValue(notFound("@app/tailordb/user"));
    await expect(
      resolve(
        "@app/tailordb/user",
        { parentURL: "file:///inherited-baseurl-project/tailor.config.ts" },
        nextResolve,
      ),
    ).rejects.toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
    expect(nextResolve).toHaveBeenCalledWith(
      expect.stringContaining("inherited-baseurl-project/shared-base/tailordb/user.ts"),
      expect.anything(),
    );
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves inherited paths using the child's own baseUrl override, not the defining config's baseUrl", async () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: "parent-base", paths: { "@shared/*": ["./*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { baseUrl: "child-base" },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const nextResolve = vi.fn().mockRejectedValue(notFound("@shared/tailordb/user"));
    await expect(
      resolve(
        "@shared/tailordb/user",
        { parentURL: "file:///override-baseurl-project/tailor.config.ts" },
        nextResolve,
      ),
    ).rejects.toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
    expect(nextResolve).toHaveBeenCalledWith(
      expect.stringContaining("override-baseurl-project/child-base/tailordb/user.ts"),
      expect.anything(),
    );
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("replaces inherited paths instead of merging when child config defines its own paths", async () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@parent/*": ["./parent-src/*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { baseUrl: ".", paths: { "@child/*": ["./child-src/*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const nextResolve = vi.fn().mockRejectedValue(notFound("@parent/foo"));
    await expect(
      resolve(
        "@parent/foo",
        { parentURL: "file:///replace-paths-project/tailor.config.ts" },
        nextResolve,
      ),
    ).rejects.toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
    expect(nextResolve).toHaveBeenCalledTimes(1);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("keeps inherited paths when child config's own paths is malformed", async () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@parent/*": ["./parent-src/*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: true },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///malformed-child-paths-project/parent-src/foo.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@parent/foo"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@parent/foo",
      { parentURL: "file:///malformed-child-paths-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("prefers more specific wildcard alias over less specific", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["./*"], "@foo/*": ["./foo-pkg/*"] },
      },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///specificity-project/foo-pkg/bar.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@foo/bar"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@foo/bar",
      { parentURL: "file:///specificity-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    expect(nextResolve).toHaveBeenLastCalledWith(
      expect.stringContaining("foo-pkg/bar"),
      expect.anything(),
    );
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("falls back to a less specific alias when a more specific alias's targets are all malformed", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@app/foo/*": [123], "@app/*": ["./*"] },
      },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///empty-target-fallback-project/foo/bar.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@app/foo/bar"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@app/foo/bar",
      { parentURL: "file:///empty-target-fallback-project/tailor.config.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("does not append extensions when tsconfig path target already has a .ts extension", async () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/utils": ["./utils/index.ts"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///ext-project/utils/index.ts" };
    const nextResolve = vi
      .fn()
      .mockRejectedValueOnce(notFound("@/utils"))
      .mockResolvedValueOnce(resolved);
    const result = await resolve(
      "@/utils",
      { parentURL: "file:///ext-project/tailor.config.ts" },
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });
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

  test("resolves non-relative specifier via tsconfig path alias", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves tsconfig path alias when parentURL has tailorImportNonce query string", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
    const resolved = { url: "file:///alias-sync-project/tailordb/user.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/tailordb/user");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/tailordb/user",
      { parentURL: "file:///alias-sync-project/tailor.config.ts?tailorImportNonce=1" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves non-relative specifier via tsconfig path alias without baseUrl", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("falls back to tsconfig directory when baseUrl is a non-string value", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: true, paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("ignores a paths alias whose target is not an array", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": "./*" } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("ignores non-string entries within a paths alias target array", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { paths: { "@/*": [123, "./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves child paths using the extended config's baseUrl directory, not the child config's directory", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: "shared-base" },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: { "@app/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("resolves inherited paths using the child's own baseUrl override, not the defining config's baseUrl", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: "parent-base", paths: { "@shared/*": ["./*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { baseUrl: "child-base" },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("replaces inherited paths instead of merging when child config defines its own paths", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@parent/*": ["./parent-src/*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { baseUrl: ".", paths: { "@child/*": ["./child-src/*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("keeps inherited paths when child config's own paths is malformed", () => {
    const baseConfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@parent/*": ["./parent-src/*"] } },
    });
    const rootConfig = JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: true },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.endsWith("tsconfig.base.json")) return baseConfig as unknown as string;
      if (p.endsWith("tsconfig.json")) return rootConfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });

  test("falls back to a less specific alias when a more specific alias's targets are all malformed", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@app/foo/*": [123], "@app/*": ["./*"] },
      },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (String(path).endsWith("tsconfig.json")) return tsconfig as unknown as string;
      return "const x: number = 1;" as unknown as string;
    });
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
    vi.mocked(readFileSync).mockReturnValue("const x: number = 1;" as unknown as string);
  });
});
