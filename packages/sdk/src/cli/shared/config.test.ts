import { describe, expect, test } from "vitest";
import { extractAllNamespaces, extractOwnedNamespaces } from "./config";
import { type LoadedConfig } from "./config-loader";

function createConfig(overrides: Partial<LoadedConfig>): LoadedConfig {
  return {
    name: "test-app",
    path: "/tmp/tailor.config.ts",
    ...overrides,
  } as LoadedConfig;
}

describe("extractAllNamespaces", () => {
  test("returns empty array when db is not configured", () => {
    const config = createConfig({});
    expect(extractAllNamespaces(config)).toEqual([]);
  });

  test("extracts all db namespace names", () => {
    const config = createConfig({
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
        analytics: { files: ["./analytics/*.ts"] },
      },
    });

    expect(extractAllNamespaces(config)).toEqual(["tailordb", "analytics"]);
  });

  test("includes external namespaces", () => {
    const config = createConfig({
      db: {
        owned: { files: ["./owned/*.ts"] },
        "shared-db": { external: true },
      },
    });

    expect(extractAllNamespaces(config)).toEqual(["owned", "shared-db"]);
  });
});

describe("extractOwnedNamespaces", () => {
  test("returns empty array when db is not configured", () => {
    const config = createConfig({});
    expect(extractOwnedNamespaces(config)).toEqual([]);
  });

  test("extracts all owned db namespace names", () => {
    const config = createConfig({
      db: {
        tailordb: { files: ["./tailordb/*.ts"] },
        analytics: { files: ["./analytics/*.ts"] },
      },
    });

    expect(extractOwnedNamespaces(config)).toEqual(["tailordb", "analytics"]);
  });

  test("excludes external namespaces", () => {
    const config = createConfig({
      db: {
        owned: { files: ["./owned/*.ts"] },
        "shared-db": { external: true },
      },
    });

    expect(extractOwnedNamespaces(config)).toEqual(["owned"]);
  });
});
