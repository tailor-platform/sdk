import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { importUserFile } from "./import-user-file";

describe("importUserFile", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeAppWithPathAlias(prefix: string, markerValue: string): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    // A package.json is required for tsx's tsconfig `paths` resolver to
    // determine this directory's module boundary/type; a real tailor project
    // always has one (it depends on @tailor-platform/sdk via npm/pnpm).
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["lib/*"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "lib", "util.ts"),
      `export const marker = ${JSON.stringify(markerValue)};\n`,
    );
    fs.writeFileSync(
      path.join(dir, "src", "resolver.ts"),
      `import { marker } from "@/util";\nexport default marker;\n`,
    );
    return dir;
  }

  test("resolves the config-local path alias against baseDir's own tsconfig", async () => {
    const appDir = makeAppWithPathAlias("import-user-file-alias-", "app-marker");
    const resolverFile = path.join(appDir, "src", "resolver.ts");

    const result = await importUserFile(resolverFile, appDir);

    expect(result.default).toBe("app-marker");
  });

  test("does not resolve one app's alias against a different app's tsconfig", async () => {
    const appA = makeAppWithPathAlias("import-user-file-appA-", "appA-marker");
    const appB = makeAppWithPathAlias("import-user-file-appB-", "appB-marker");

    const resultA = await importUserFile(path.join(appA, "src", "resolver.ts"), appA);
    const resultB = await importUserFile(path.join(appB, "src", "resolver.ts"), appB);

    expect(resultA.default).toBe("appA-marker");
    expect(resultB.default).toBe("appB-marker");
  });

  test("falls back to a plain import when baseDir has no tsconfig", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "import-user-file-plain-")));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const file = path.join(dir, "plain.ts");
    fs.writeFileSync(file, `export default "plain-value";\n`);

    const isolatedRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "import-user-file-isolated-")),
    );
    tmpDirs.push(isolatedRoot);
    fs.writeFileSync(path.join(isolatedRoot, "package.json"), JSON.stringify({ type: "module" }));

    const result = await importUserFile(file, isolatedRoot);

    expect(result.default).toBe("plain-value");
  });

  test("resolves concurrent loads against their own app's alias without cross-talk", async () => {
    const apps = Array.from({ length: 6 }, (_, i) =>
      makeAppWithPathAlias(`import-user-file-concurrent-${i}-`, `marker-${i}`),
    );

    const results = await Promise.all(
      apps.map((appDir) => importUserFile(path.join(appDir, "src", "resolver.ts"), appDir)),
    );

    expect(results.map((r) => r.default)).toEqual(apps.map((_, i) => `marker-${i}`));
  });

  test("falls back to a plain import when a paths target can't be resolved through tsx", async () => {
    // A `paths` entry can redirect a real, plain-import-resolvable specifier
    // into a location that itself relies on a package.json `imports`
    // (`#`-prefixed) subpath — resolution tsx's tsconfig-aware loader doesn't
    // replicate, so it throws instead of following it. This mirrors this
    // repo's own tsconfig.json, which aliases "@tailor-platform/sdk" back to
    // its own source (for the SDK's own build/typecheck), and that source
    // uses `#/*` internal imports. The fixture aliases "pathe" (a real,
    // already-installed dependency) instead, so the fallback's plain import
    // resolves it for real rather than depending on this repo's own alias.
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(import.meta.dirname, ".import-user-file-unresolvable-paths-")),
    );
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "fixture-pkg", type: "module", imports: { "#/*": "./lib/*" } }),
    );
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { pathe: ["./lib/entry.ts"] } } }),
    );
    fs.writeFileSync(
      path.join(dir, "lib", "marker.ts"),
      `export const marker = "via-hash-import";\n`,
    );
    fs.writeFileSync(path.join(dir, "lib", "entry.ts"), `export { marker } from "#/marker";\n`);
    fs.writeFileSync(
      path.join(dir, "resolver.ts"),
      `import { join } from "pathe";\nexport default typeof join;\n`,
    );

    const result = await importUserFile(path.join(dir, "resolver.ts"), dir);

    // Recovered via the real "pathe" package (fallback), not the unresolvable alias target.
    expect(result.default).toBe("function");
  });
});
