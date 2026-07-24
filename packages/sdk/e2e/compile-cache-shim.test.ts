/**
 * E2E tests for the compile-cache bin shim (dist/cli/index.mjs, generated at
 * build time by `politty generate-shim`).
 *
 * Verifies that:
 * - `tailor`'s `bin` entry (dist/cli/index.mjs) is the generated shim that
 *   enables Node's on-disk compile cache (via `politty/compile-cache`)
 *   before dynamically importing the real CLI entry (dist/cli/main.mjs).
 * - The shim actually starts the CLI correctly and populates/reuses the
 *   on-disk cache across runs.
 *
 * No Platform authentication or network access required.
 *
 * Prerequisites:
 * - packages/sdk must be built (dist/cli/index.mjs and dist/cli/main.mjs
 *   must exist)
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
// Namespace import: `enableCompileCache` doesn't exist on Node < 22.8, and a
// named import of a missing binding would fail at link time, before the
// runtime feature check below can run.
import * as nodeModule from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sdkRoot = path.resolve(__dirname, "..");
const shimPath = path.join(sdkRoot, "dist", "cli", "index.mjs");
const mainPath = path.join(sdkRoot, "dist", "cli", "main.mjs");
const packageJson = JSON.parse(fs.readFileSync(path.join(sdkRoot, "package.json"), "utf-8")) as {
  version: string;
  bin: Record<string, string>;
};

// Node < 22.8.0 has no `module.enableCompileCache`; the shim silently no-ops
// there, so the cache-population assertions below don't hold.
const compileCacheSupported = typeof nodeModule.enableCompileCache === "function";

function runShim(args: string[], cacheHome: string): string {
  return execFileSync(process.execPath, [shimPath, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    // Cleared, not omitted: NODE_COMPILE_CACHE always wins over XDG_CACHE_HOME
    // when set, so a value inherited from the parent (dev shell, CI) would
    // silently defeat these tests' cacheHome isolation otherwise.
    env: { ...process.env, XDG_CACHE_HOME: cacheHome, NODE_COMPILE_CACHE: "" },
    encoding: "utf-8",
    timeout: 30000,
  });
}

function collectCacheMtimes(cacheDir: string): string[] {
  if (!fs.existsSync(cacheDir)) return [];
  return (fs.readdirSync(cacheDir, { recursive: true }) as string[])
    .toSorted()
    .map((entry) => `${entry}:${fs.statSync(path.join(cacheDir, entry)).mtimeMs}`);
}

describe("compile-cache bin shim", () => {
  test("tailor's bin points at the shim, which loads main.mjs", () => {
    expect(packageJson.bin.tailor).toBe("./dist/cli/index.mjs");
    expect(fs.existsSync(shimPath)).toBe(true);
    expect(fs.existsSync(mainPath)).toBe(true);

    const content = fs.readFileSync(shimPath, "utf-8");
    expect(content).toContain('await import("politty/compile-cache")');
    expect(content).toContain('enableCompileCache("tailor")');
    expect(content).toContain('await import("./main.mjs")');
  });

  test("the shim starts the real CLI and reports the correct version", () => {
    const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-compile-cache-"));
    try {
      expect(runShim(["--version"], cacheHome).trim()).toBe(packageJson.version);
    } finally {
      fs.rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  test("the shim dispatches subcommands correctly", () => {
    const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-compile-cache-"));
    try {
      expect(runShim(["tailordb", "--help"], cacheHome)).toContain(
        "Manage TailorDB tables and data.",
      );
    } finally {
      fs.rmSync(cacheHome, { recursive: true, force: true });
    }
  });

  test.skipIf(!compileCacheSupported)(
    "running the shim populates the on-disk compile cache",
    () => {
      const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-compile-cache-"));
      try {
        runShim(["--version"], cacheHome);
        const cacheDir = path.join(cacheHome, "tailor", "node-compile-cache");
        expect(fs.existsSync(cacheDir)).toBe(true);
        expect(collectCacheMtimes(cacheDir).length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(cacheHome, { recursive: true, force: true });
      }
    },
  );

  test.skipIf(!compileCacheSupported)(
    "a second run reuses the cache instead of rewriting it",
    () => {
      const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-compile-cache-"));
      try {
        runShim(["--version"], cacheHome);
        const cacheDir = path.join(cacheHome, "tailor", "node-compile-cache");
        const before = collectCacheMtimes(cacheDir);

        runShim(["--version"], cacheHome);
        const after = collectCacheMtimes(cacheDir);

        expect(after).toEqual(before);
      } finally {
        fs.rmSync(cacheHome, { recursive: true, force: true });
      }
    },
  );
});
