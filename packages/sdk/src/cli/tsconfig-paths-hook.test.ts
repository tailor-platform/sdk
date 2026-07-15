import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveSync } from "./tsconfig-paths-hook.mjs";

const notFound = (specifier: string) =>
  Object.assign(new Error(`Cannot find '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });

function makeProject(tsconfig: object): { dir: string; parentURL: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-paths-hook-test-")));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
  return { dir, parentURL: pathToFileURL(path.join(dir, "resolver.ts")).href };
}

describe("resolveSync", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("delegates to nextResolve first and returns its result on success", () => {
    const resolved = { url: "file:///node_modules/some-package/index.js" };
    const nextResolve = vi.fn().mockReturnValue(resolved);
    const result = resolveSync("some-package", {}, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("rethrows ERR_MODULE_NOT_FOUND for non-relative specifiers with no matching tsconfig", () => {
    const { dir, parentURL } = makeProject({ compilerOptions: { baseUrl: ".", paths: {} } });
    dirs.push(dir);
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("some-package");
    });
    expect(() => resolveSync("some-package", { parentURL }, nextResolve)).toThrow(
      "Cannot find 'some-package'",
    );
  });

  test("does not intercept relative specifiers, leaving them to tsx/Node", () => {
    const nextResolve = vi.fn().mockImplementation(() => {
      throw notFound("./foo");
    });
    expect(() => resolveSync("./foo", {}, nextResolve)).toThrow("Cannot find './foo'");
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("resolves non-relative specifier via tsconfig path alias from the importing file's own directory", () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/utils.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "utils")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".ts") return resolved;
      throw notFound(specifier);
    });
    const result = resolveSync("@/utils", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("resolves each importing file's alias against its own project, not a previously loaded one", () => {
    const projectA = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./a-src/*"] } },
    });
    const projectB = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./b-src/*"] } },
    });
    dirs.push(projectA.dir, projectB.dir);

    const resolvedA = { url: "file:///a-src/utils.ts" };
    const candidateA = pathToFileURL(path.join(projectA.dir, "a-src", "utils")).href;
    const nextResolveA = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === candidateA + ".ts") return resolvedA;
      throw notFound(specifier);
    });
    expect(resolveSync("@/utils", { parentURL: projectA.parentURL }, nextResolveA)).toEqual(
      resolvedA,
    );

    const resolvedB = { url: "file:///b-src/utils.ts" };
    const candidateB = pathToFileURL(path.join(projectB.dir, "b-src", "utils")).href;
    const nextResolveB = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === candidateB + ".ts") return resolvedB;
      throw notFound(specifier);
    });
    expect(resolveSync("@/utils", { parentURL: projectB.parentURL }, nextResolveB)).toEqual(
      resolvedB,
    );
  });

  test("strips search/hash from parentURL before deriving the importing file's directory", () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/utils.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "utils")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".ts") return resolved;
      throw notFound(specifier);
    });
    const result = resolveSync(
      "@/utils",
      { parentURL: `${parentURL}?tailorImportNonce=1` },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("resolves paths inherited through an extends chain", () => {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-paths-hook-test-")),
    );
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base.json" }),
    );
    const parentURL = pathToFileURL(path.join(dir, "resolver.ts")).href;

    const resolved = { url: "file:///resolved/utils.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "utils")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".ts") return resolved;
      throw notFound(specifier);
    });
    const result = resolveSync("@/utils", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("prefers the more specific wildcard alias", () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["./src/*"], "@/foo/*": ["./foo-pkg/*"] },
      },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/bar.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "foo-pkg", "bar")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".ts") return resolved;
      throw notFound(specifier);
    });
    const result = resolveSync("@/foo/bar", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("resolves a directory-style alias target via its index file", () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/models/index.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "models")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + "/index.ts") return resolved;
      throw notFound(specifier);
    });
    const result = resolveSync("@/models", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });
});
