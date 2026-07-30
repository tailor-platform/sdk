import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { afterEach, describe, expect, test } from "vitest";
import { createVirtualEntry } from "#/cli/shared/virtual-entry";
import { createBundleLog } from "./bundle-log";
import { createTsconfigPathsPlugin } from "./tsconfig-paths-plugin";

describe("createTsconfigPathsPlugin", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeDir(prefix: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    tmpDirs.push(dir);
    return dir;
  }

  // The bundler is explicitly given the nested tsconfig, which does not extend
  // the root config and therefore must not inherit its aliases.
  function makeNestedProject(): { entry: string; nestedTsconfig: string } {
    const dir = makeDir("tsconfig-paths-nested-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(path.join(dir, "services", "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );
    return {
      entry: path.join(dir, "services", "entry.ts"),
      nestedTsconfig: path.join(dir, "services", "tsconfig.json"),
    };
  }

  async function build(entry: string, tsconfig: string, plugins: rolldown.Plugin[] = []) {
    const bundleLog = createBundleLog({ tsconfig });
    const result = await rolldown.build({
      input: entry,
      write: false,
      output: { format: "esm", codeSplitting: false },
      tsconfig,
      plugins,
      ...bundleLog.options,
    } as rolldown.BuildOptions);
    bundleLog.assertAllResolved();
    return result;
  }

  test("a nested tsconfig does not implicitly inherit root aliases", async () => {
    const { entry, nestedTsconfig } = makeNestedProject();

    await expect(build(entry, nestedTsconfig)).rejects.toThrow(/Could not resolve "@lib\/helpers"/);
  });

  test("resolves an alias declared by the importing file's nearest tsconfig", async () => {
    const dir = makeDir("tsconfig-paths-importer-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["../lib/*"] } },
      }),
    );
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    const entry = path.join(dir, "services", "entry.ts");
    fs.writeFileSync(
      entry,
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );

    const result = await build(entry, path.join(dir, "tsconfig.json"), [
      createTsconfigPathsPlugin(),
    ]);

    expect(result.output[0].code).not.toContain('from "@lib/helpers"');
    expect(result.output[0].code).toContain("42");
  });

  test("resolves an alias to a directory index file", async () => {
    const dir = makeDir("tsconfig-paths-index-");
    fs.mkdirSync(path.join(dir, "lib", "nested"), { recursive: true });
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["../lib/*"] } },
      }),
    );
    fs.writeFileSync(path.join(dir, "lib", "nested", "index.ts"), "export const v = 7;\n");
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { v } from "@lib/nested";\nexport const main = () => v;\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain("7");
  });

  test("maps a .js-suffixed alias specifier onto its TypeScript source", async () => {
    const dir = makeDir("tsconfig-paths-jsext-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["../lib/*"] } },
      }),
    );
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 11;\n");
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { helper } from "@lib/helpers.js";\nexport const main = () => helper();\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain("11");
  });

  test("leaves a genuinely missing specifier unresolved", async () => {
    const dir = makeDir("tsconfig-paths-missing-");
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, "entry.ts"), 'import "@nope/missing";\nexport const m = 1;\n');

    await expect(
      build(path.join(dir, "entry.ts"), path.join(dir, "tsconfig.json"), [
        createTsconfigPathsPlugin(),
      ]),
    ).rejects.toThrow(/Could not resolve "@nope\/missing"/);
  });

  test("does not rerun resolution when no paths pattern matches", async () => {
    const dir = makeDir("tsconfig-paths-unmatched-");
    const entry = path.join(dir, "entry.ts");
    const tsconfig = path.join(dir, "tsconfig.json");
    const specifier = "unmatched-package";
    fs.writeFileSync(
      tsconfig,
      JSON.stringify({ compilerOptions: { paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(entry, `import "${specifier}";\nexport const m = 1;\n`);

    let resolutionCount = 0;
    const resolutionProbe: rolldown.Plugin = {
      name: "resolution-probe",
      resolveId(source) {
        if (source === specifier) resolutionCount++;
        return null;
      },
    };

    await rolldown.build({
      input: entry,
      write: false,
      output: { format: "esm", codeSplitting: false },
      tsconfig,
      logLevel: "silent",
      plugins: [resolutionProbe, createTsconfigPathsPlugin()],
    } as rolldown.BuildOptions);

    expect(resolutionCount).toBe(1);
  });

  // A `"*"` catch-all alias whose target exists on disk must still lose to a
  // real package, so the plugin cannot silently redirect a working import.
  test("does not shadow a real node_modules package with an existing alias target", async () => {
    const dir = makeDir("tsconfig-paths-pkg-");
    fs.mkdirSync(path.join(dir, "node_modules", "real-pkg"), { recursive: true });
    fs.mkdirSync(path.join(dir, "shims"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(
      path.join(dir, "node_modules", "real-pkg", "package.json"),
      JSON.stringify({ name: "real-pkg", version: "1.0.0", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "real-pkg", "index.js"),
      'export const origin = "FROM_NODE_MODULES";\n',
    );
    fs.writeFileSync(
      path.join(dir, "shims", "real-pkg.ts"),
      'export const origin = "FROM_SHIM";\n',
    );
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "*": ["../shims/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { origin } from "real-pkg";\nexport const main = () => origin;\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain("FROM_NODE_MODULES");
    expect(result.output[0].code).not.toContain("FROM_SHIM");
  });

  test("uses paths inherited through the nearest tsconfig's extends chain", async () => {
    const dir = makeDir("tsconfig-paths-extends-nearest-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(path.join(dir, "build-tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "base.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({ extends: "../base.json" }),
    );
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "build-tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain("42");
  });

  test("does not inherit paths from above the nearest tsconfig", async () => {
    const { entry, nestedTsconfig } = makeNestedProject();

    await expect(build(entry, nestedTsconfig, [createTsconfigPathsPlugin()])).rejects.toThrow(
      /Could not resolve "@lib\/helpers"/,
    );
  });

  // rolldown resolves these forms for a relative import, so delegating each
  // mapped candidate back to it must preserve them.
  test.each([
    ["a .tsx source behind a .js specifier", "helpers.tsx", "@lib/helpers.js", "33"],
    ["a .js source with allowJs left at its default", "helpers.js", "@lib/helpers", "44"],
  ])("resolves %s", async (_label, targetFile, specifier, value) => {
    const dir = makeDir("tsconfig-paths-forms-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["../lib/*"] } },
      }),
    );
    fs.writeFileSync(path.join(dir, "lib", targetFile), `export const helper = () => ${value};\n`);
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      `import { helper } from "${specifier}";\nexport const main = () => helper();\n`,
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain(value);
  });

  test("resolves an alias target that is a package directory with no index file", async () => {
    const dir = makeDir("tsconfig-paths-pkgdir-");
    fs.mkdirSync(path.join(dir, "lib", "widget"), { recursive: true });
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "services", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["../lib/*"] } },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "lib", "widget", "package.json"),
      JSON.stringify({ name: "widget", main: "./impl.js" }),
    );
    fs.writeFileSync(
      path.join(dir, "lib", "widget", "impl.js"),
      "export const helper = () => 66;\n",
    );
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { helper } from "@lib/widget";\nexport const main = () => helper();\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain("66");
  });

  test("reports an extends base and every walked directory as a dependency", async () => {
    const dir = makeDir("tsconfig-paths-extends-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "base.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ extends: "./base.json" }));
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    fs.writeFileSync(
      path.join(dir, "a", "b", "entry.ts"),
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );

    const reported: string[] = [];
    await build(path.join(dir, "a", "b", "entry.ts"), path.join(dir, "tsconfig.json"), [
      createTsconfigPathsPlugin({ onTsconfigRead: (p) => reported.push(p) }),
    ]);

    expect(new Set(reported)).toEqual(
      new Set([
        path.join(dir, "a", "b", "tsconfig.json"),
        path.join(dir, "a", "tsconfig.json"),
        path.join(dir, "tsconfig.json"),
        path.join(dir, "base.json"),
      ]),
    );
  });

  test("reports both candidates when an extends target gains a .json suffix", async () => {
    const dir = makeDir("tsconfig-paths-extends-suffix-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.base.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "./tsconfig.base" }),
    );
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    fs.writeFileSync(
      path.join(dir, "entry.ts"),
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );

    const reported: string[] = [];
    await build(path.join(dir, "entry.ts"), path.join(dir, "tsconfig.json"), [
      createTsconfigPathsPlugin({ onTsconfigRead: (p) => reported.push(p) }),
    ]);

    expect(new Set(reported)).toEqual(
      new Set([
        path.join(dir, "tsconfig.json"),
        path.join(dir, "tsconfig.base"),
        path.join(dir, "tsconfig.base.json"),
      ]),
    );
  });

  test("reports package metadata and config used by a package-style extends", async () => {
    const dir = makeDir("tsconfig-paths-extends-package-");
    const configPackageDir = path.join(dir, "node_modules", "shared-tsconfig");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(configPackageDir, { recursive: true });
    fs.writeFileSync(
      path.join(configPackageDir, "package.json"),
      JSON.stringify({ name: "shared-tsconfig", version: "1.0.0", main: "tsconfig.json" }),
    );
    fs.writeFileSync(
      path.join(configPackageDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: "../..", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ extends: "shared-tsconfig" }),
    );
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 42;\n");
    fs.writeFileSync(
      path.join(dir, "entry.ts"),
      'import { helper } from "@lib/helpers";\nexport const main = () => helper();\n',
    );

    const reported: string[] = [];
    await build(path.join(dir, "entry.ts"), path.join(dir, "tsconfig.json"), [
      createTsconfigPathsPlugin({ onTsconfigRead: (p) => reported.push(p) }),
    ]);

    expect(new Set(reported)).toEqual(
      new Set([
        path.join(dir, "tsconfig.json"),
        path.join(configPackageDir, "package.json"),
        path.join(configPackageDir, "tsconfig.json"),
      ]),
    );
  });

  test("resolves a user alias inlined into a virtual entry when given its source file", async () => {
    const dir = makeDir("tsconfig-paths-virtual-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "tailordb"));
    fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(
      path.join(dir, "tailordb", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["../lib/*"] } },
      }),
    );
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 77;\n");
    const sourceFile = path.join(dir, "tailordb", "user.ts");
    fs.writeFileSync(sourceFile, "export const unused = 1;\n");
    const entry = createVirtualEntry(
      "tailordb-script:User:0",
      'import { helper } from "@lib/helpers";\nexport function main() { return helper(); }\n',
      "ts",
    );

    const tsconfig = path.join(dir, "tsconfig.json");
    const bundleLog = createBundleLog({ tsconfig });
    const result = await rolldown.build({
      input: entry.input,
      write: false,
      output: { format: "esm", codeSplitting: false },
      tsconfig,
      plugins: [entry.plugin, createTsconfigPathsPlugin({ virtualEntrySourceFile: sourceFile })],
      ...bundleLog.options,
    } as rolldown.BuildOptions);
    bundleLog.assertAllResolved();

    expect(result.output[0].code).toContain("77");
  });
});
