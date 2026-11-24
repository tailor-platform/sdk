import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { brandedDefault } from "#/cli/shared/test-helpers/workspace-config";

const packageDir = path.resolve(import.meta.dirname, "..");
const postinstallPath = path.join(packageDir, "postinstall.mjs");
const libPath = path.join(packageDir, "dist", "cli", "lib.mjs");

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("postinstall", () => {
  test.each([
    {
      kind: "defineConfig()",
      source: `export default { name: "shop", env: { APP_ENV: "DEV" } };`,
      registryEntry: `shop: "unset";`,
    },
    {
      kind: "defineWorkspace()",
      source: brandedDefault(
        "workspace-config",
        `{
          env: { APP_ENV: "DEV" },
          db: { "main-db": { files: [] } },
          apps: { shop: { db: ["main-db"] } },
        }`,
      ),
      registryEntry: `workspace: "unset";`,
    },
  ])("writes tailor.d.ts next to a $kind config", ({ source, registryEntry }) => {
    expect(fs.existsSync(libPath), `${libPath} is missing: run pnpm build`).toBe(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-postinstall-"));
    tempDirs.push(dir);
    fs.writeFileSync(path.join(dir, "tailor.config.ts"), source);

    const result = spawnSync(process.execPath, [postinstallPath], {
      cwd: dir,
      env: { ...process.env, INIT_CWD: dir },
      encoding: "utf8",
    });

    const dtsPath = path.join(dir, "tailor.d.ts");
    expect(fs.existsSync(dtsPath), `${result.stdout}${result.stderr}`).toBe(true);
    const dts = fs.readFileSync(dtsPath, "utf8");
    expect(dts).toContain("APP_ENV: string;");
    expect(dts).toContain(registryEntry);
  });
});
