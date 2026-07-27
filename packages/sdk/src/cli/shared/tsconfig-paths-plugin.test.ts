import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import * as rolldown from "rolldown";
import { afterEach, describe, expect, test } from "vitest";
import { createBundleLogOptions } from "./bundle-log";
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

  // The alias lives in the project-root tsconfig, but a nested tsconfig
  // without `paths` sits nearer to the importing file and is what the bundler
  // hands rolldown.
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

  function build(entry: string, tsconfig: string, plugins: rolldown.Plugin[] = []) {
    return rolldown.build({
      input: entry,
      write: false,
      output: { format: "esm", codeSplitting: false },
      tsconfig,
      plugins,
      ...createBundleLogOptions({ tsconfig }),
    } as rolldown.BuildOptions);
  }

  test("without the plugin the nested tsconfig shadows the root aliases", async () => {
    const { entry, nestedTsconfig } = makeNestedProject();

    await expect(build(entry, nestedTsconfig)).rejects.toThrow(/Could not resolve "@lib\/helpers"/);
  });

  test("resolves an alias declared above the importing file's nearest tsconfig", async () => {
    const { entry, nestedTsconfig } = makeNestedProject();

    const result = await build(entry, nestedTsconfig, [createTsconfigPathsPlugin()]);

    expect(result.output[0].code).not.toContain('from "@lib/helpers"');
    expect(result.output[0].code).toContain("42");
  });

  test("resolves an alias to a directory index file", async () => {
    const dir = makeDir("tsconfig-paths-index-");
    fs.mkdirSync(path.join(dir, "lib", "nested"), { recursive: true });
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(path.join(dir, "services", "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, "lib", "nested", "index.ts"), "export const v = 7;\n");
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { v } from "@lib/nested";\nexport const main = () => v;\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "services", "tsconfig.json"),
      [createTsconfigPathsPlugin()],
    );

    expect(result.output[0].code).toContain("7");
  });

  test("maps a .js-suffixed alias specifier onto its TypeScript source", async () => {
    const dir = makeDir("tsconfig-paths-jsext-");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.mkdirSync(path.join(dir, "services"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["./lib/*"] } } }),
    );
    fs.writeFileSync(path.join(dir, "services", "tsconfig.json"), JSON.stringify({}));
    fs.writeFileSync(path.join(dir, "lib", "helpers.ts"), "export const helper = () => 11;\n");
    fs.writeFileSync(
      path.join(dir, "services", "entry.ts"),
      'import { helper } from "@lib/helpers.js";\nexport const main = () => helper();\n',
    );

    const result = await build(
      path.join(dir, "services", "entry.ts"),
      path.join(dir, "services", "tsconfig.json"),
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

  test("does not shadow a real node_modules package with an alias miss", async () => {
    const dir = makeDir("tsconfig-paths-pkg-");
    fs.mkdirSync(path.join(dir, "node_modules", "real-pkg"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "node_modules", "real-pkg", "package.json"),
      JSON.stringify({ name: "real-pkg", version: "1.0.0", main: "index.js" }),
    );
    fs.writeFileSync(
      path.join(dir, "node_modules", "real-pkg", "index.js"),
      "export const fromPkg = 99;\n",
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "*": ["./shims/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "entry.ts"),
      'import { fromPkg } from "real-pkg";\nexport const main = () => fromPkg;\n',
    );

    const result = await build(path.join(dir, "entry.ts"), path.join(dir, "tsconfig.json"), [
      createTsconfigPathsPlugin(),
    ]);

    expect(result.output[0].code).toContain("99");
  });
});
