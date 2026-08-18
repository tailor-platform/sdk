import * as fs from "node:fs";
import * as path from "pathe";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetchRemoteSchemaSnapshot } from "#/cli/commands/tailordb/migrate/schema-checks";
import {
  SCHEMA_SNAPSHOT_VERSION,
  normalizeSchemaSnapshot,
  type SchemaSnapshot,
} from "#/cli/commands/tailordb/migrate/snapshot";
import { loadTailorDBNamespaces } from "#/cli/shared/tailordb-namespaces";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import {
  SCRIPT_SNAPSHOT_FILE_NAME,
  assertGeneratedTypeScript,
  generateScriptDbTypes,
  generateScriptSkeleton,
  isGeneratedScriptDbTypes,
  loadScriptSchemaSnapshot,
  verifyScriptSchemaSnapshot,
} from "./script-scaffold";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";

vi.mock("#/cli/commands/tailordb/migrate/schema-checks", async (importActual) => {
  const actual = await importActual<object>();
  return { ...actual, fetchRemoteSchemaSnapshot: vi.fn() };
});

vi.mock("#/cli/shared/tailordb-namespaces", () => ({
  loadTailorDBNamespaces: vi.fn(),
}));

function makeSnapshot(): SchemaSnapshot {
  return {
    version: SCHEMA_SNAPSHOT_VERSION,
    namespace: "tailordb",
    createdAt: "2026-01-01T00:00:00.000Z",
    tables: {
      Product: {
        name: "Product",
        pluralForm: "products",
        fields: {
          name: { type: "string", required: true },
          status: {
            type: "enum",
            required: false,
            allowedValues: [{ value: "draft" }, { value: "active" }],
          },
          tags: { type: "string", required: true, array: true },
          shippedAt: { type: "datetime", required: false },
          invoiceNumber: { type: "string", required: true, serial: { start: 1 } },
          createdAt: { type: "datetime", required: true, hooks: { create: { expr: "now()" } } },
          updatedAt: { type: "datetime", required: true, optionalOnCreate: true },
          profile: {
            type: "nested",
            required: false,
            fields: {
              bio: { type: "string", required: false },
            },
          },
        },
      },
    },
  };
}

describe("generateScriptDbTypes", () => {
  test("emits a getDB-exporting types file covering field shapes", () => {
    const content = generateScriptDbTypes(makeSnapshot());

    expect(isGeneratedScriptDbTypes(content)).toBe(true);
    expect(content).toContain('from "@tailor-platform/sdk/kysely"');
    expect(content).toContain('"tailordb": {');
    expect(content).toContain("export const getDB = createGetDB<Namespace>();");
    expect(content).toContain("name: string;");
    expect(content).toContain('status: "draft" | "active" | null;');
    expect(content).toContain("tags: string[];");
    expect(content).toContain("shippedAt: Timestamp | null;");
    expect(content).toContain("invoiceNumber: Serial<string>;");
    expect(content).toContain("createdAt: Generated<Timestamp>;");
    expect(content).toContain("updatedAt: Generated<Timestamp>;");
    expect(content).toContain("ObjectColumnType<{");
    expect(content).toContain("id: Generated<string>;");
  });

  test("does not classify a hand-written db.ts as generated", () => {
    expect(
      isGeneratedScriptDbTypes('export const getDB = () => { throw new Error("stub"); };'),
    ).toBe(false);
  });
});

describe("generateScriptSkeleton", () => {
  test("imports getDB and demonstrates a transaction", () => {
    const content = generateScriptSkeleton({
      getDBImportPath: "../generated/tailordb",
      namespace: "tailordb",
    });

    expect(content).toContain('import { getDB } from "../generated/tailordb";');
    expect(content).toContain('const db = getDB("tailordb");');
    expect(content).toContain("export default async function main()");
    expect(content).toContain("db.transaction().execute(async (trx)");
    expect(content).toContain("Performance and Large Tables");
  });

  test("escapes literals so unusual names still produce parseable TypeScript", () => {
    const content = generateScriptSkeleton({
      getDBImportPath: './weird"path',
      namespace: 'ta"ilordb',
    });

    expect(() => assertGeneratedTypeScript("fix.ts", content)).not.toThrow();
    expect(content).toContain('getDB("ta\\"ilordb")');
  });
});

describe("assertGeneratedTypeScript", () => {
  test("accepts parseable TypeScript and rejects broken output", () => {
    expect(() => assertGeneratedTypeScript("ok.ts", "export const a = 1;")).not.toThrow();
    expect(() => assertGeneratedTypeScript("broken.ts", 'const x = "unterminated;')).toThrow(
      /does not parse as TypeScript/,
    );
  });
});

describe("loadScriptSchemaSnapshot", () => {
  test("returns null when the script has no snapshot sidecar", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    expect(loadScriptSchemaSnapshot(scriptPath)).toBeNull();
  });

  test("loads and normalizes a snapshot sidecar", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    fs.writeFileSync(
      path.join(tmp.dir, SCRIPT_SNAPSHOT_FILE_NAME),
      JSON.stringify({ ...makeSnapshot(), source: "local" }),
    );

    const sidecar = loadScriptSchemaSnapshot(scriptPath);
    expect(sidecar?.snapshot.namespace).toBe("tailordb");
    expect(Object.keys(sidecar?.snapshot.tables ?? {})).toEqual(["Product"]);
    expect(sidecar?.source).toBe("local");
    expect(sidecar?.snapshot).not.toHaveProperty("source");
  });

  test("treats a legacy snapshot without a source as remote", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    fs.writeFileSync(path.join(tmp.dir, SCRIPT_SNAPSHOT_FILE_NAME), JSON.stringify(makeSnapshot()));

    expect(loadScriptSchemaSnapshot(scriptPath)?.source).toBe("remote");
  });

  test("rejects an unknown snapshot source", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    fs.writeFileSync(
      path.join(tmp.dir, SCRIPT_SNAPSHOT_FILE_NAME),
      JSON.stringify({ ...makeSnapshot(), source: "cache" }),
    );

    expect(() => loadScriptSchemaSnapshot(scriptPath)).toThrow(/unexpected shape/);
  });

  test("rejects an unparseable snapshot with a regenerate hint", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    fs.writeFileSync(path.join(tmp.dir, SCRIPT_SNAPSHOT_FILE_NAME), "{broken");

    expect(() => loadScriptSchemaSnapshot(scriptPath)).toThrow(/tailor function script/);
  });

  test("rejects a snapshot with an unexpected shape", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    fs.writeFileSync(path.join(tmp.dir, SCRIPT_SNAPSHOT_FILE_NAME), JSON.stringify({ foo: 1 }));

    expect(() => loadScriptSchemaSnapshot(scriptPath)).toThrow(/unexpected shape/);
  });

  test("rejects a snapshot whose tables cannot be normalized", () => {
    using tmp = tempCwd("sdk-script-scaffold-");
    const scriptPath = path.join(tmp.dir, "fix.ts");
    fs.writeFileSync(
      path.join(tmp.dir, SCRIPT_SNAPSHOT_FILE_NAME),
      JSON.stringify({ namespace: "tailordb", tables: { Product: { name: "Product" } } }),
    );

    expect(() => loadScriptSchemaSnapshot(scriptPath)).toThrow(/unexpected shape/);
  });
});

describe("verifyScriptSchemaSnapshot", () => {
  const client = {} as OperatorClient;

  beforeEach(() => {
    vi.mocked(fetchRemoteSchemaSnapshot).mockReset();
    vi.mocked(loadTailorDBNamespaces).mockReset();
  });

  function makeOptions(
    config: { db?: unknown } = {},
    snapshot: SchemaSnapshot = makeSnapshot(),
    source: "local" | "remote" = "remote",
  ) {
    return {
      client,
      workspaceId: "ws-1",
      config: { path: "/proj/tailor.config.ts", ...config } as LoadedConfig,
      configArgValue: "tailor.config.ts",
      scriptArgValue: "scripts/fix.ts",
      sidecar: {
        snapshotPath: `/proj/scripts/${SCRIPT_SNAPSHOT_FILE_NAME}`,
        snapshot: normalizeSchemaSnapshot(snapshot),
        source,
      },
    };
  }

  test("passes when the deployed schema matches the snapshot", async () => {
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(makeSnapshot()));

    await expect(verifyScriptSchemaSnapshot(makeOptions())).resolves.toBeUndefined();
    expect(loadTailorDBNamespaces).not.toHaveBeenCalled();
  });

  test("ignores deployed metadata the generated types do not depend on", async () => {
    const remoteWithMetadata = makeSnapshot();
    remoteWithMetadata.tables.Product!.description = "added later";
    remoteWithMetadata.tables.Product!.settings = { aggregation: true };
    remoteWithMetadata.tables.Product!.forwardRelationships = {
      author: {
        targetType: "User",
        targetField: "id",
        sourceField: "authorID",
        isArray: false,
        description: "",
      },
    };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(
      normalizeSchemaSnapshot(remoteWithMetadata),
    );

    await expect(verifyScriptSchemaSnapshot(makeOptions())).resolves.toBeUndefined();
  });

  test("rejects when a field's platform-filled-on-create contract flips remotely", async () => {
    const drifted = makeSnapshot();
    const nameField = drifted.tables.Product!.fields.name;
    drifted.tables.Product!.fields.name = { ...nameField!, optionalOnCreate: true };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(drifted));

    await expect(verifyScriptSchemaSnapshot(makeOptions())).rejects.toThrow(
      /no longer matches the deployed schema/,
    );
  });

  test("rejects when the deployed schema drifted", async () => {
    const drifted = makeSnapshot();
    drifted.tables.Product!.fields.price = { type: "float", required: false };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(drifted));

    await expect(verifyScriptSchemaSnapshot(makeOptions())).rejects.toThrow(
      /no longer matches the deployed schema/,
    );
    await expect(verifyScriptSchemaSnapshot(makeOptions())).rejects.toThrow(
      /tailor function script scripts\/fix\.ts/,
    );
    await expect(verifyScriptSchemaSnapshot(makeOptions())).rejects.toThrow(/--remote/);
    await expect(verifyScriptSchemaSnapshot(makeOptions())).rejects.toThrow(/--allow-schema-drift/);
  });

  test("accepts a local snapshot when the deployed schema carries the same generated contract", async () => {
    const remoteDerived = makeSnapshot();
    const createdAt = remoteDerived.tables.Product!.fields.createdAt!;
    remoteDerived.tables.Product!.fields.createdAt = {
      ...createdAt,
      hooks: undefined,
      optionalOnCreate: true,
    };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(remoteDerived));

    await expect(
      verifyScriptSchemaSnapshot(makeOptions({}, makeSnapshot(), "local")),
    ).resolves.toBeUndefined();
  });

  test("rejects a local snapshot when its generated-on-create contract drifted", async () => {
    const remoteDerived = makeSnapshot();
    const createdAt = remoteDerived.tables.Product!.fields.createdAt!;
    remoteDerived.tables.Product!.fields.createdAt = {
      ...createdAt,
      hooks: undefined,
      optionalOnCreate: undefined,
    };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(remoteDerived));

    await expect(
      verifyScriptSchemaSnapshot(makeOptions({}, makeSnapshot(), "local")),
    ).rejects.toThrow(/no longer matches the deployed schema/);
  });

  test("ignores script-bearing props the platform does not store verbatim", async () => {
    const localProduct = {
      name: "Product",
      pluralForm: "products",
      settings: {},
      typeHookExpr: "compiled-type-hook",
      forwardRelationships: {},
      backwardRelationships: {},
      permissions: {},
      fields: {
        id: { config: { type: "uuid", required: true } },
        name: { config: { type: "string", required: true, default: "unnamed" } },
        status: {
          config: {
            type: "enum",
            required: false,
            allowedValues: [{ value: "draft" }, { value: "active" }],
          },
        },
        tags: { config: { type: "string", required: true, array: true } },
        shippedAt: { config: { type: "datetime", required: false } },
        invoiceNumber: { config: { type: "string", required: true, serial: { start: 1 } } },
        createdAt: {
          config: {
            type: "datetime",
            required: true,
            hooks: { create: { expr: "locally-compiled-now()" } },
          },
        },
        updatedAt: {
          config: {
            type: "datetime",
            required: true,
            hooks: { update: { expr: "locally-compiled-now()" } },
          },
        },
        profile: {
          config: {
            type: "nested",
            required: false,
            fields: { bio: { type: "string", required: false } },
          },
        },
      },
    };
    vi.mocked(loadTailorDBNamespaces).mockResolvedValue({
      config: {} as never,
      plugins: [],
      namespaces: [
        { namespace: "tailordb", tables: { Product: localProduct }, sourceInfo: new Map() },
      ],
    } as never);
    const remoteDerived = makeSnapshot();
    remoteDerived.tables.Product!.fields.id = {
      type: "uuid",
      required: true,
      optionalOnCreate: true,
    };
    remoteDerived.tables.Product!.fields.name = {
      ...remoteDerived.tables.Product!.fields.name!,
      optionalOnCreate: true,
    };
    remoteDerived.tables.Product!.fields.updatedAt = {
      ...remoteDerived.tables.Product!.fields.updatedAt!,
      optionalOnCreate: undefined,
    };
    remoteDerived.tables.Product!.forwardRelationships = {
      author: {
        targetType: "User",
        targetField: "id",
        sourceField: "authorID",
        isArray: false,
        description: "",
      },
    };
    vi.mocked(fetchRemoteSchemaSnapshot).mockResolvedValue(normalizeSchemaSnapshot(remoteDerived));

    await expect(
      verifyScriptSchemaSnapshot(makeOptions({ db: { tailordb: {} } }, remoteDerived)),
    ).resolves.toBeUndefined();
    expect(loadTailorDBNamespaces).toHaveBeenCalled();
    expect(fetchRemoteSchemaSnapshot).toHaveBeenCalled();
  });

  test("rejects when the local table definitions drifted", async () => {
    vi.mocked(loadTailorDBNamespaces).mockResolvedValue({
      config: {} as never,
      plugins: [],
      namespaces: [{ namespace: "tailordb", tables: {}, sourceInfo: new Map() }],
    } as never);

    await expect(verifyScriptSchemaSnapshot(makeOptions({ db: { tailordb: {} } }))).rejects.toThrow(
      /no longer matches the local table definitions/,
    );
    expect(loadTailorDBNamespaces).toHaveBeenCalledWith({
      configPath: "tailor.config.ts",
      namespaces: ["tailordb"],
    });
    expect(fetchRemoteSchemaSnapshot).not.toHaveBeenCalled();
  });
});
