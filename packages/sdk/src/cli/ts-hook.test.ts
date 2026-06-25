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
});
