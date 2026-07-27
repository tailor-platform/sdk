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

  test("ignores an unresolved import injected by a bundler's own virtual entry", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bundle-log-virtual-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    const entry = createVirtualEntry(
      "resolver:demo",
      'import { t } from "@tailor-platform/sdk-not-installed-here";\nexport const main = () => t;\n',
    );

    const result = await rolldown.build({
      input: entry.input,
      write: false,
      output: { format: "esm", codeSplitting: false },
      plugins: [entry.plugin],
      tsconfig: path.join(dir, "tsconfig.json"),
      ...createBundleLogOptions({ tsconfig: path.join(dir, "tsconfig.json") }),
    } as rolldown.BuildOptions);

    expect(result.output[0].code).toContain('from "@tailor-platform/sdk-not-installed-here"');
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
