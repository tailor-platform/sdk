import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { resolveSync } from "./tsconfig-paths-hook.mjs";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

const notFound = (specifier: string) =>
  Object.assign(new Error(`Cannot find '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });

describe("resolveSync", () => {
  test("delegates to nextResolve first and returns its result on success", () => {
    const resolved = { url: "file:///node_modules/some-package/index.js" };
    const nextResolve = vi.fn().mockReturnValue(resolved);
    const result = resolveSync("some-package", {}, nextResolve);
    expect(result).toEqual(resolved);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  test("rethrows ERR_MODULE_NOT_FOUND for non-relative specifiers with no matching tsconfig", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("some-package");
    });
    expect(() => resolveSync("some-package", {}, nextResolve)).toThrow(
      "Cannot find 'some-package'",
    );
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("does not intercept relative specifiers, leaving them to tsx/Node", () => {
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("./foo");
    });
    expect(() => resolveSync("./foo", {}, nextResolve)).toThrow("Cannot find './foo'");
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("resolves non-relative specifier via tsconfig path alias from the importing file's own directory", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation(() => tsconfig as unknown as string);
    const resolved = { url: "file:///alias-project/src/utils.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/utils");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/utils",
      { parentURL: "file:///alias-project/resolver.ts" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("resolves each importing file's alias against its own project, not a previously loaded one", () => {
    const tsconfigA = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./a-src/*"] } },
    });
    const tsconfigB = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./b-src/*"] } },
    });
    vi.mocked(readFileSync).mockImplementation((path) => {
      const p = String(path);
      if (p.startsWith("/appA")) return tsconfigA as unknown as string;
      if (p.startsWith("/appB")) return tsconfigB as unknown as string;
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const resolvedA = { url: "file:///appA/a-src/utils.ts" };
    const nextResolveA = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/utils");
      })
      .mockReturnValueOnce(resolvedA);
    expect(resolveSync("@/utils", { parentURL: "file:///appA/resolver.ts" }, nextResolveA)).toEqual(
      resolvedA,
    );

    const resolvedB = { url: "file:///appB/b-src/utils.ts" };
    const nextResolveB = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/utils");
      })
      .mockReturnValueOnce(resolvedB);
    expect(resolveSync("@/utils", { parentURL: "file:///appB/resolver.ts" }, nextResolveB)).toEqual(
      resolvedB,
    );
  });

  test("strips search/hash from parentURL before deriving the importing file's directory", () => {
    const tsconfig = JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"] } },
    });
    vi.mocked(readFileSync).mockImplementation(() => tsconfig as unknown as string);
    const resolved = { url: "file:///nonce-project/src/utils.ts" };
    const nextResolve = vi
      .fn()
      .mockImplementationOnce(() => {
        throw notFound("@/utils");
      })
      .mockReturnValueOnce(resolved);
    const result = resolveSync(
      "@/utils",
      { parentURL: "file:///nonce-project/resolver.ts?tailorImportNonce=1" },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });
});
