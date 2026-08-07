import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { afterEach, describe, expect, test } from "vitest";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import { createBundleLog } from "./bundle-log";
import { isCLIError } from "./errors";

describe("createBundleLog", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Mirrors the layout that silently shipped a broken bundle: an alias declared
  // in the project-root tsconfig, and a nested tsconfig without `paths` that
  // rolldown picks instead because it sits nearer to the importing file.
  function makeProject(): { dir: string; entry: string; nestedTsconfig: string } {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-")));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "nested"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(path.join(dir, "nested", "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    fs.writeFileSync(
      path.join(dir, "nested", "entry.ts"),
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );
    return {
      dir,
      entry: path.join(dir, "nested", "entry.ts"),
      nestedTsconfig: path.join(dir, "nested", "tsconfig.json"),
    };
  }

  function build(entry: string, tsconfig: string, extra: rolldown.InputOptions = {}) {
    return rolldown.build({
      input: entry,
      write: false,
      output: { format: "esm", codeSplitting: false },
      tsconfig,
      ...extra,
    } as rolldown.BuildOptions);
  }

  async function buildWithBundleLog(
    entry: string,
    tsconfig: string,
    extra: rolldown.InputOptions = {},
  ) {
    const bundleLog = createBundleLog({ tsconfig });
    const result = await build(entry, tsconfig, { ...extra, ...bundleLog.options });
    bundleLog.assertAllResolved();
    return result;
  }

  test("logLevel silent lets an unresolved import through, proving the escalation is load-bearing", async () => {
    const { entry, nestedTsconfig } = makeProject();

    const result = await build(entry, nestedTsconfig, { logLevel: "silent" });

    expect(result.output[0].code).toContain('from "@lib/helpers"');
  });

  test("fails the build when an import cannot be resolved", async () => {
    const { entry, nestedTsconfig } = makeProject();

    await expect(buildWithBundleLog(entry, nestedTsconfig)).rejects.toThrow(
      /Could not resolve "@lib\/helpers"/,
    );
  });

  test("surfaces unresolved imports as a CLIError outside rolldown", async () => {
    const { entry, nestedTsconfig } = makeProject();
    const error = await buildWithBundleLog(entry, nestedTsconfig).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect(isCLIError(error)).toBe(true);
    if (!isCLIError(error)) return;
    expect(error.message).not.toContain("at createCLIError");
    expect(error.suggestion).toContain("compilerOptions.paths");
    expect(error.format()).not.toContain("bundle-log.ts");
  });

  test("reports every unresolved import in one error", async () => {
    const { entry, nestedTsconfig } = makeProject();
    fs.writeFileSync(
      entry,
      'import "@lib/first";\nimport "@lib/second";\nexport const main = () => 1;\n',
    );

    const error = await buildWithBundleLog(entry, nestedTsconfig).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(isCLIError(error)).toBe(true);
    if (!isCLIError(error)) return;
    expect(error.details).toContain("@lib/first");
    expect(error.details).toContain("@lib/second");
  });

  test.each(["node:crypto", "fs/promises"])(
    "suggests Web Standard APIs for the Node built-in %s",
    async (specifier) => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-node-")));
      tmpDirs.push(dir);
      const tsconfig = path.join(dir, "tsconfig.json");
      const entry = path.join(dir, "entry.ts");
      fs.writeFileSync(tsconfig, JSON.stringify({}));
      fs.writeFileSync(entry, `import "${specifier}";\nexport const main = () => 1;\n`);

      const error = await buildWithBundleLog(entry, tsconfig).then(
        () => null,
        (caught: unknown) => caught,
      );

      expect(isCLIError(error)).toBe(true);
      if (!isCLIError(error)) return;
      expect(error.format()).toMatch(/Web (Crypto|Standard) API|File system access/);
      expect(error.format()).not.toContain("compilerOptions.paths");
    },
  );

  test("names the tsconfig the aliases were resolved against", async () => {
    const { entry, nestedTsconfig } = makeProject();
    const error = await buildWithBundleLog(entry, nestedTsconfig).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(isCLIError(error)).toBe(true);
    if (!isCLIError(error)) return;
    expect(error.format()).toMatch(
      new RegExp(nestedTsconfig.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("succeeds when the tsconfig in effect declares the alias", async () => {
    const { dir, entry } = makeProject();
    const rootTsconfig = path.join(dir, "tsconfig.json");

    const result = await buildWithBundleLog(entry, rootTsconfig);

    expect(result.output[0].code).not.toContain('from "@lib/helpers"');
    expect(result.output[0].code).toContain("42");
  });

  test.each([
    "@tailor-platform/sdk",
    "@tailor-platform/sdk/kysely",
    "@tailor-platform/function-kysely-tailordb",
  ])("fails when the regular dependency %s cannot be resolved", async (specifier) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-dependency-")));
    tmpDirs.push(dir);
    const tsconfig = path.join(dir, "tsconfig.json");
    const entry = path.join(dir, "entry.ts");
    const emptyModules = path.join(dir, "empty-modules");
    fs.writeFileSync(tsconfig, JSON.stringify({}));
    fs.writeFileSync(entry, `import "${specifier}";\nexport const main = () => 1;\n`);
    fs.mkdirSync(emptyModules);

    await expect(
      buildWithBundleLog(entry, tsconfig, {
        resolve: { modules: [emptyModules] },
      }),
    ).rejects.toThrow(/Could not resolve/);
  });

  test.each([
    "@tailor-platform/my-private-utils",
    "@tailor-platform/sdk/no-such-subpath",
    "@tailor-platform/sdk-typo",
  ])("escalates the unresolved in-scope specifier %s", async (specifier) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-scope-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "entry.ts"),
      `import { x } from "${specifier}";\nexport const main = () => x;\n`,
    );

    await expect(
      buildWithBundleLog(path.join(dir, "entry.ts"), path.join(dir, "tsconfig.json")),
    ).rejects.toThrow(/Could not resolve/);
  });

  test("escalates an unresolved import inside a generated entry", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-inlined-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    const entry = createVirtualEntry(
      "tailordb-script:User:0",
      'import { helper } from "@lib/helpers";\nexport function main() { return helper(); }\n',
      "ts",
    );

    await expect(async () => {
      const bundleLog = createBundleLog({ tsconfig: path.join(dir, "tsconfig.json") });
      await rolldown.build({
        input: entry.input,
        write: false,
        output: { format: "esm", codeSplitting: false },
        tsconfig: path.join(dir, "tsconfig.json"),
        plugins: [entry.plugin],
        ...bundleLog.options,
      } as rolldown.BuildOptions);
      bundleLog.assertAllResolved();
    }).rejects.toThrow(/Could not resolve "@lib\/helpers"/);
  });

  test("names a generated entry without leaking its control-character prefix", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-idlabel-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    const entry = createVirtualEntry(
      "tailordb-script:User:0",
      'import "@lib/missing";\nexport const main = () => 1;\n',
      "ts",
    );

    const error = await (async () => {
      const bundleLog = createBundleLog({ tsconfig: path.join(dir, "tsconfig.json") });
      await rolldown.build({
        input: entry.input,
        write: false,
        output: { format: "esm", codeSplitting: false },
        tsconfig: path.join(dir, "tsconfig.json"),
        plugins: [entry.plugin],
        ...bundleLog.options,
      } as rolldown.BuildOptions);
      bundleLog.assertAllResolved();
    })().then(
      () => "",
      (caught: Error) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/a generated entry \(tailor-sdk-entry:/);
    expect((error as Error).message).not.toContain(String.fromCodePoint(0));
  });

  test("keeps non-escalated rolldown logs from failing the build", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-circular-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    // A circular import warns (CIRCULAR_DEPENDENCY) without indicating a broken bundle.
    fs.writeFileSync(
      path.join(dir, "a.ts"),
      'import { b } from "./b";\nexport const a = () => b();\n',
    );
    fs.writeFileSync(
      path.join(dir, "b.ts"),
      'import { a } from "./a";\nexport const b = () => a;\n',
    );

    const result = await buildWithBundleLog(
      path.join(dir, "a.ts"),
      path.join(dir, "tsconfig.json"),
      {
        checks: { circularDependency: true },
      } as rolldown.InputOptions,
    );

    expect(result.output[0].code).toBeTruthy();
  });
});
