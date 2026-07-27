import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { afterEach, describe, expect, test } from "vitest";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import { createBundleLogOptions } from "./bundle-log";

describe("createBundleLogOptions", () => {
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

  test("logLevel silent lets an unresolved import through, proving the escalation is load-bearing", async () => {
    const { entry, nestedTsconfig } = makeProject();

    const result = await build(entry, nestedTsconfig, { logLevel: "silent" });

    expect(result.output[0].code).toContain('from "@lib/helpers"');
  });

  test("fails the build when an import cannot be resolved", async () => {
    const { entry, nestedTsconfig } = makeProject();

    await expect(
      build(entry, nestedTsconfig, createBundleLogOptions({ tsconfig: nestedTsconfig })),
    ).rejects.toThrow(/Could not resolve "@lib\/helpers"/);
  });

  test("names the tsconfig the aliases were resolved against", async () => {
    const { entry, nestedTsconfig } = makeProject();

    await expect(
      build(entry, nestedTsconfig, createBundleLogOptions({ tsconfig: nestedTsconfig })),
    ).rejects.toThrow(new RegExp(nestedTsconfig.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  test("succeeds when the tsconfig in effect declares the alias", async () => {
    const { dir, entry } = makeProject();
    const rootTsconfig = path.join(dir, "tsconfig.json");

    const result = await build(
      entry,
      rootTsconfig,
      createBundleLogOptions({ tsconfig: rootTsconfig }),
    );

    expect(result.output[0].code).not.toContain('from "@lib/helpers"');
    expect(result.output[0].code).toContain("42");
  });

  // Platform-supplied `@tailor-platform` modules stay unresolved wherever they
  // are not installed, so they must never fail the build.
  test.each([
    ["a rolldown virtual entry", undefined],
    ["a physical entry file", "entry"],
  ])(
    "ignores an unresolved platform import injected into %s",
    async (_label, physicalEntryName) => {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-injected-")));
      tmpDirs.push(dir);
      fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
      // `function-kysely-tailordb` is what `@tailor-platform/sdk/kysely`
      // re-exports, and it is absent from this fixture's tree, so it stands in
      // for the injected imports of a project where the SDK is not installed.
      const code =
        'import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";\nexport const main = () => TailordbDialect;\n';

      const options: rolldown.InputOptions & { input: string } = physicalEntryName
        ? { input: path.join(dir, `${physicalEntryName}.entry.ts`) }
        : (() => {
            const entry = createVirtualEntry("resolver:demo", code, "ts");
            return { input: entry.input, plugins: [entry.plugin] };
          })();
      if (physicalEntryName) fs.writeFileSync(options.input, code);

      // An empty module directory makes the injected specifier unresolvable
      // here, matching a project where the platform packages are not installed.
      fs.mkdirSync(path.join(dir, "empty-modules"));
      const result = await rolldown.build({
        ...options,
        write: false,
        output: { format: "esm", codeSplitting: false },
        tsconfig: path.join(dir, "tsconfig.json"),
        resolve: { modules: [path.join(dir, "empty-modules")] },
        ...createBundleLogOptions({ tsconfig: path.join(dir, "tsconfig.json") }),
      } as rolldown.BuildOptions);

      expect(result.output[0].code).toContain('from "@tailor-platform/function-kysely-tailordb"');
    },
  );

  // The exemption is an exact allowlist, not the `@tailor-platform/` scope: a
  // user's private package or a typo of a published one must still fail.
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
      build(
        path.join(dir, "entry.ts"),
        path.join(dir, "tsconfig.json"),
        createBundleLogOptions({ tsconfig: path.join(dir, "tsconfig.json") }),
      ),
    ).rejects.toThrow(/Could not resolve/);
  });

  // Only `@tailor-platform` specifiers are exempt: an entry that inlines user
  // code carries the user's imports too, and a miss there is a real defect.
  test("escalates a non-platform unresolved import inside a generated entry", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-inlined-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    const entry = createVirtualEntry(
      "tailordb-script:User:0",
      'import { helper } from "@lib/helpers";\nexport function main() { return helper(); }\n',
      "ts",
    );

    await expect(
      rolldown.build({
        input: entry.input,
        write: false,
        output: { format: "esm", codeSplitting: false },
        tsconfig: path.join(dir, "tsconfig.json"),
        plugins: [entry.plugin],
        ...createBundleLogOptions({ tsconfig: path.join(dir, "tsconfig.json") }),
      } as rolldown.BuildOptions),
    ).rejects.toThrow(/Could not resolve "@lib\/helpers"/);
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

    const build = rolldown.build({
      input: entry.input,
      write: false,
      output: { format: "esm", codeSplitting: false },
      tsconfig: path.join(dir, "tsconfig.json"),
      plugins: [entry.plugin],
      ...createBundleLogOptions({ tsconfig: path.join(dir, "tsconfig.json") }),
    } as rolldown.BuildOptions);

    await expect(build).rejects.toThrow(/a generated entry \(tailor-sdk-entry:/);
    const message = await build.then(
      () => "",
      (error: Error) => error.message,
    );
    expect(message).not.toContain(String.fromCodePoint(0));
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

    const result = await build(path.join(dir, "a.ts"), path.join(dir, "tsconfig.json"), {
      ...createBundleLogOptions({ tsconfig: path.join(dir, "tsconfig.json") }),
      checks: { circularDependency: true },
    } as rolldown.InputOptions);

    expect(result.output[0].code).toBeTruthy();
  });
});
