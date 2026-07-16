import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolve } from "./tsconfig-paths-hook.mjs";

const notFound = (specifier: string) =>
  Object.assign(new Error(`Cannot find '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });

const dirImport = (specifier: string) =>
  Object.assign(new Error(`Directory import '${specifier}' is not supported`), {
    code: "ERR_UNSUPPORTED_DIR_IMPORT",
  });

const packageImportNotDefined = (specifier: string) =>
  Object.assign(new Error(`Package import specifier "${specifier}" is not defined`), {
    code: "ERR_PACKAGE_IMPORT_NOT_DEFINED",
  });

function makeProject(tsconfig: object): { dir: string; parentURL: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-paths-hook-test-")));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
  return { dir, parentURL: pathToFileURL(path.join(dir, "resolver.ts")).href };
}

describe("resolve", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("delegates to nextResolve first and returns its result on success", async () => {
    const resolved = { url: "file:///node_modules/some-package/index.js" };
    const nextResolve = vi.fn().mockResolvedValue(resolved);
    const result = await resolve("some-package", {}, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("known limitation: does not correct a specifier that a coincidentally-matching alias in a different tsconfig already resolved successfully", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    // Simulates tsx's own tsconfig-paths support (scoped to a different,
    // cwd-discovered tsconfig that happens to share the same alias pattern)
    // succeeding against the wrong target before this hook ever gets a
    // chance to run — it only activates on ERR_MODULE_NOT_FOUND.
    const wrongResolution = { url: "file:///unrelated-project/src/utils.ts" };
    const nextResolve = vi.fn().mockResolvedValue(wrongResolution);
    const result = await resolve("@/utils", { parentURL }, nextResolve);
    expect(result).toEqual(wrongResolution);
  });

  test("rethrows ERR_MODULE_NOT_FOUND for non-relative specifiers with no matching tsconfig", async () => {
    const { dir, parentURL } = makeProject({ compilerOptions: { baseUrl: ".", paths: {} } });
    dirs.push(dir);
    const nextResolve = vi.fn().mockRejectedValue(notFound("some-package"));
    await expect(resolve("some-package", { parentURL }, nextResolve)).rejects.toThrow(
      "Cannot find 'some-package'",
    );
  });

  test("does not intercept relative specifiers, leaving them to tsx/Node", async () => {
    const nextResolve = vi.fn().mockRejectedValue(notFound("./foo"));
    await expect(resolve("./foo", {}, nextResolve)).rejects.toThrow("Cannot find './foo'");
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });

  test("resolves non-relative specifier via tsconfig path alias from the importing file's own directory", async () => {
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
    const result = await resolve("@/utils", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("resolves each importing file's alias against its own project, not a previously loaded one", async () => {
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
    await expect(
      resolve("@/utils", { parentURL: projectA.parentURL }, nextResolveA),
    ).resolves.toEqual(resolvedA);

    const resolvedB = { url: "file:///b-src/utils.ts" };
    const candidateB = pathToFileURL(path.join(projectB.dir, "b-src", "utils")).href;
    const nextResolveB = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === candidateB + ".ts") return resolvedB;
      throw notFound(specifier);
    });
    await expect(
      resolve("@/utils", { parentURL: projectB.parentURL }, nextResolveB),
    ).resolves.toEqual(resolvedB);
  });

  test("strips search/hash from parentURL before deriving the importing file's directory", async () => {
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
    const result = await resolve(
      "@/utils",
      { parentURL: `${parentURL}?tailorImportNonce=1` },
      nextResolve,
    );
    expect(result).toEqual(resolved);
  });

  test("resolves paths inherited through an extends chain", async () => {
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
    const result = await resolve("@/utils", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("prefers the more specific wildcard alias", async () => {
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
    const result = await resolve("@/foo/bar", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("resolves a directory-style alias target via its index file", async () => {
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
    const result = await resolve("@/models", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("attempts the tsconfig paths fallback when the initial resolution fails with ERR_UNSUPPORTED_DIR_IMPORT", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/models/index.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "models")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + "/index.ts") return resolved;
      if (specifier === "@/models") throw dirImport(specifier);
      throw notFound(specifier);
    });
    const result = await resolve("@/models", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("prefers a sibling file over a same-name directory's index, matching TypeScript's own resolution order", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const siblingFile = { url: "file:///resolved/foo.tsx" };
    const directoryIndex = { url: "file:///resolved/foo/index.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "foo")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".tsx") return siblingFile;
      if (specifier === expectedCandidate + "/index.ts") return directoryIndex;
      throw notFound(specifier);
    });
    const result = await resolve("@/foo", { parentURL }, nextResolve);
    expect(result).toEqual(siblingFile);
  });

  test("maps a .js specifier extension to the corresponding TS source extension instead of appending a TS extension", async () => {
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
    const result = await resolve("@/utils.js", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
    expect(nextResolve).not.toHaveBeenCalledWith(
      expect.stringContaining("utils.js.ts"),
      expect.anything(),
    );
  });

  test("probes an allowed .js source for an extensionless alias when allowJs is set", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", allowJs: true, paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/utils.js" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "utils")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".js") return resolved;
      throw notFound(specifier);
    });
    const result = await resolve("@/utils", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("does not probe .js sources for an extensionless alias when allowJs is unset", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      throw notFound(specifier);
    });
    await expect(resolve("@/utils", { parentURL }, nextResolve)).rejects.toThrow(
      "Cannot find '@/utils'",
    );
    expect(nextResolve).not.toHaveBeenCalledWith(expect.stringContaining(".js"), expect.anything());
  });

  test("attempts the tsconfig paths fallback for a subpath-imports specifier failing with ERR_PACKAGE_IMPORT_NOT_DEFINED", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "#/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const resolved = { url: "file:///resolved/utils.ts" };
    const expectedCandidate = pathToFileURL(path.join(dir, "src", "utils")).href;
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      if (specifier === expectedCandidate + ".ts") return resolved;
      if (specifier === "#/utils") throw packageImportNotDefined(specifier);
      throw notFound(specifier);
    });
    const result = await resolve("#/utils", { parentURL }, nextResolve);
    expect(result).toEqual(resolved);
  });

  test("does not treat ERR_PACKAGE_IMPORT_NOT_DEFINED as recoverable for a non-subpath-imports specifier", async () => {
    const { dir, parentURL } = makeProject({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
    });
    dirs.push(dir);
    const nextResolve = vi.fn().mockImplementation((specifier: string) => {
      throw packageImportNotDefined(specifier);
    });
    await expect(resolve("@/utils", { parentURL }, nextResolve)).rejects.toMatchObject({
      code: "ERR_PACKAGE_IMPORT_NOT_DEFINED",
    });
    expect(nextResolve).toHaveBeenCalledTimes(1);
  });
});
