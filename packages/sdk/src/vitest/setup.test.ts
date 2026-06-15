import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createBlockedGlobalsLifecycle,
  extractVaultStore,
  loadSecretsFromConfig,
  removeBlockedGlobals,
  restoreBlockedGlobals,
} from "./setup";

describe("extractVaultStore", () => {
  test("unwraps a defineSecretManager() shape via the .vaults field", () => {
    // Mimics the runtime-private shape: `vaults` is the canonical map.
    const secrets = {
      vaults: { aws: { ACCESS_KEY: "k1", SECRET: "s1" } },
      options: {},
      get: () => undefined,
      getAll: () => ({}),
    };
    expect(extractVaultStore(secrets)).toEqual({
      aws: { ACCESS_KEY: "k1", SECRET: "s1" },
    });
  });

  test("treats a plain object as the vault map directly when there is no .vaults field", () => {
    const secrets = { aws: { K: "v" }, gcp: { P: "q" } };
    expect(extractVaultStore(secrets)).toEqual({
      aws: { K: "v" },
      gcp: { P: "q" },
    });
  });

  test("clones each vault so callers cannot mutate the source", () => {
    const aws = { K: "v" };
    const secrets = { aws };
    const store = extractVaultStore(secrets);
    expect(store).not.toBeNull();
    // Mutating the store must not affect the original.
    store!.aws!.K = "modified";
    expect(aws.K).toBe("v");
  });

  test("skips non-object vault entries (e.g. accidental string values)", () => {
    const secrets = {
      aws: { K: "v" },
      bogus: "not an object",
      gcp: null,
    };
    expect(extractVaultStore(secrets)).toEqual({ aws: { K: "v" } });
  });

  test("returns null for nullish or non-object inputs", () => {
    expect(extractVaultStore(undefined)).toBeNull();
    expect(extractVaultStore(null)).toBeNull();
    expect(extractVaultStore("string")).toBeNull();
    expect(extractVaultStore(42)).toBeNull();
  });

  test("returns null when the resolved source has no usable vaults", () => {
    expect(extractVaultStore({})).toBeNull();
    expect(extractVaultStore({ vaults: {} })).toBeNull();
    // All entries non-object → store stays empty → null.
    expect(extractVaultStore({ a: "x", b: 1 })).toBeNull();
  });

  test("handles `{ vaults: null }` by falling through to the plain-object branch", () => {
    // null vaults is treated as "no defineSecretManager shape", so the outer
    // object is examined as a plain map. With only the (non-object) `vaults`
    // key present, no usable entries remain → null.
    expect(extractVaultStore({ vaults: null })).toBeNull();
    // Outer keys siblings to a null `vaults` are still picked up.
    expect(extractVaultStore({ vaults: null, aws: { K: "v" } })).toEqual({
      aws: { K: "v" },
    });
  });
});

describe("loadSecretsFromConfig", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tailor-runtime-secrets-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("loads secrets from a default-exported config object", async () => {
    const path = join(tmpDir, "default-export.mjs");
    writeFileSync(path, `export default { secrets: { aws: { K: "v1" } } };`, "utf8");
    const store = await loadSecretsFromConfig(path);
    expect(store).toEqual({ aws: { K: "v1" } });
  });

  test("falls back to a top-level `secrets` named export when no default", async () => {
    const path = join(tmpDir, "named-export.mjs");
    writeFileSync(path, `export const secrets = { aws: { K: "v2" } };`, "utf8");
    const store = await loadSecretsFromConfig(path);
    expect(store).toEqual({ aws: { K: "v2" } });
  });

  test("returns null when the config has no usable secrets", async () => {
    const path = join(tmpDir, "no-secrets.mjs");
    writeFileSync(path, `export default { unrelated: true };`, "utf8");
    expect(await loadSecretsFromConfig(path)).toBeNull();
  });

  test("swallows errors and returns null for a missing config file", async () => {
    expect(await loadSecretsFromConfig(join(tmpDir, "does-not-exist.mjs"))).toBeNull();
  });

  test("swallows errors and returns null for a syntactically invalid config", async () => {
    const path = join(tmpDir, "broken.mjs");
    writeFileSync(path, `this is not valid javascript {{{`, "utf8");
    expect(await loadSecretsFromConfig(path)).toBeNull();
  });

  test("loads a TypeScript config via the Vitest module loader", async () => {
    // The documented usage is `tailorRuntime({ config: "./tailor.config.ts" })`.
    // Vitest's worker installs a vite-node loader that intercepts dynamic
    // `import()` and transforms .ts files on the fly, so this path must work.
    // Regression guard against switching to a native Node-only loader.
    const path = join(tmpDir, "config.ts");
    writeFileSync(
      path,
      `type Vault = Record<string, string>;\nexport default { secrets: { aws: { K: "ts-v" } as Vault } };`,
      "utf8",
    );
    const store = await loadSecretsFromConfig(path);
    expect(store).toEqual({ aws: { K: "ts-v" } });
  });
});

describe("removeBlockedGlobals", () => {
  test("deletes configurable properties and returns their descriptors", () => {
    const g: Record<string, unknown> = {};
    Object.defineProperty(g, "performance", {
      value: { now: () => 1 },
      configurable: true,
      writable: true,
      enumerable: true,
    });
    const removed = removeBlockedGlobals(g, ["performance"]);
    expect("performance" in g).toBe(false);
    expect(removed.performance?.value).toEqual({ now: expect.any(Function) });
  });

  test("silently skips non-configurable properties so the caller does not crash", () => {
    // Regression guard: in strict-mode runtimes (or platforms that lock down
    // `performance`), `delete g.performance` throws TypeError. The helper
    // must skip the deletion AND must not record a descriptor — otherwise
    // afterEach would try to redefine a property that was never removed.
    const g: Record<string, unknown> = {};
    const value = { now: () => 1 };
    Object.defineProperty(g, "performance", {
      value,
      configurable: false,
      writable: false,
      enumerable: true,
    });
    expect(() => removeBlockedGlobals(g, ["performance"])).not.toThrow();
    const removed = removeBlockedGlobals(g, ["performance"]);
    // Property still present, descriptor not recorded.
    expect(g.performance).toBe(value);
    expect(removed.performance).toBeUndefined();
  });

  test("ignores keys that are not present at all", () => {
    const g: Record<string, unknown> = {};
    const removed = removeBlockedGlobals(g, ["missing"]);
    expect(removed.missing).toBeUndefined();
  });
});

describe("restoreBlockedGlobals", () => {
  test("re-defines previously-removed properties", () => {
    const g: Record<string, unknown> = {};
    Object.defineProperty(g, "performance", {
      value: { now: () => 7 },
      configurable: true,
      writable: true,
      enumerable: true,
    });
    const saved = removeBlockedGlobals(g, ["performance"]);
    expect("performance" in g).toBe(false);
    restoreBlockedGlobals(g, saved);
    expect((g.performance as { now: () => number }).now()).toBe(7);
  });

  test("is a no-op when the saved map is empty (e.g. all keys were skipped)", () => {
    const g: Record<string, unknown> = { other: 1 };
    expect(() => restoreBlockedGlobals(g, {})).not.toThrow();
    expect(g.other).toBe(1);
  });
});

describe("createBlockedGlobalsLifecycle (concurrent-test safety)", () => {
  // Helper: build a global with a configurable `performance` property.
  function withPerformance(): Record<string, unknown> {
    const g: Record<string, unknown> = {};
    Object.defineProperty(g, "performance", {
      value: { now: () => 1 },
      configurable: true,
      writable: true,
      enumerable: true,
    });
    return g;
  }

  test("removes globals on first enter and restores on matching exit", () => {
    const g = withPerformance();
    const lifecycle = createBlockedGlobalsLifecycle();
    lifecycle.enter(g, ["performance"]);
    expect("performance" in g).toBe(false);
    lifecycle.exit(g);
    expect("performance" in g).toBe(true);
  });

  test("nested enter does NOT re-snapshot or re-delete; the union is kept removed", () => {
    // Regression guard for `test.concurrent`: when test B's beforeEach runs
    // while test A is still mid-flight, the property must stay removed and
    // the descriptor saved on A's enter must be the one ultimately restored.
    const g = withPerformance();
    const originalDescriptor = Object.getOwnPropertyDescriptor(g, "performance");
    const lifecycle = createBlockedGlobalsLifecycle();

    lifecycle.enter(g, ["performance"]); // test A starts
    expect("performance" in g).toBe(false);
    lifecycle.enter(g, ["performance"]); // test B starts
    expect("performance" in g).toBe(false);

    lifecycle.exit(g); // test B finishes — must NOT restore yet
    expect("performance" in g).toBe(false);

    lifecycle.exit(g); // test A finishes — final exit restores
    expect(Object.getOwnPropertyDescriptor(g, "performance")?.value).toBe(
      originalDescriptor?.value,
    );
  });

  test("active counter reflects the number of overlapping scopes", () => {
    const g = withPerformance();
    const lifecycle = createBlockedGlobalsLifecycle();
    expect(lifecycle.active).toBe(0);
    lifecycle.enter(g, ["performance"]);
    expect(lifecycle.active).toBe(1);
    lifecycle.enter(g, ["performance"]);
    expect(lifecycle.active).toBe(2);
    lifecycle.exit(g);
    expect(lifecycle.active).toBe(1);
    lifecycle.exit(g);
    expect(lifecycle.active).toBe(0);
  });

  test("exit is a no-op when active is already 0 (defensive against desynced hooks)", () => {
    const g = withPerformance();
    const lifecycle = createBlockedGlobalsLifecycle();
    expect(() => lifecycle.exit(g)).not.toThrow();
    expect(lifecycle.active).toBe(0);
    expect("performance" in g).toBe(true);
  });

  test("after a complete cycle, a new enter starts a fresh snapshot", () => {
    // Cycle 1: enter→exit must clear saved state so cycle 2 captures the
    // CURRENT descriptor, not the stale one from cycle 1.
    const g = withPerformance();
    const lifecycle = createBlockedGlobalsLifecycle();

    lifecycle.enter(g, ["performance"]);
    lifecycle.exit(g);

    // Replace `performance` between cycles — cycle 2 must snapshot the new value.
    Object.defineProperty(g, "performance", {
      value: { now: () => 999 },
      configurable: true,
      writable: true,
      enumerable: true,
    });

    lifecycle.enter(g, ["performance"]);
    lifecycle.exit(g);
    expect((g.performance as { now: () => number }).now()).toBe(999);
  });
});
