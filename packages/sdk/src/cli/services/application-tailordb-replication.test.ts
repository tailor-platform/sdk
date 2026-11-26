import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { defineConfig } from "#/configure/config/index";
import { defineTailorDBReplicationDestination } from "#/configure/services/tailordb-replication/index";
import { defineApplication, loadApplication } from "./application";
import type { AppConfig } from "#/configure/config/types";

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

type ConfigOverrides = Partial<Pick<AppConfig, "db" | "dbReplicationDestinations">>;

function configOf(overrides: ConfigOverrides, dir = "/project") {
  return {
    ...defineConfig({ name: "shop", ...overrides }),
    path: path.join(dir, "tailor.config.ts"),
  };
}

describe("defineApplication TailorDB replications", () => {
  test("collects each namespace's replications and the destinations they use", () => {
    const application = defineApplication({
      config: configOf({
        db: {
          "main-db": {
            files: [],
            replications: {
              analytics: { destination: warehouse, tablePrefix: "shop_" },
              lake: undefined,
            },
          },
        },
      }),
    });

    expect(application.dbReplicationDestinations).toEqual([
      { name: "warehouse", bigquery: { project: "acme-analytics", dataset: "tailor" } },
    ]);
    expect(application.dbReplications).toEqual([
      {
        name: "analytics",
        source: { namespace: "main-db" },
        destination: "warehouse",
        tablePrefix: "shop_",
        enabled: true,
        types: [],
      },
    ]);
  });

  test("keeps a listed destination no replication uses", () => {
    const application = defineApplication({
      config: configOf({ dbReplicationDestinations: [warehouse] }),
    });

    expect(application.dbReplicationDestinations.map(({ name }) => name)).toEqual(["warehouse"]);
  });

  test("rejects two different destinations with the same name", () => {
    const other = defineTailorDBReplicationDestination("warehouse", {
      bigquery: { project: "acme-analytics", dataset: "lake" },
    });

    expect(() =>
      defineApplication({
        config: configOf({
          dbReplicationDestinations: [warehouse],
          db: { "main-db": { files: [], replications: { analytics: { destination: other } } } },
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'db.main-db.replications.analytics.destination: Two different destinations are named "warehouse"',
        ),
      }),
    );
  });

  test("rejects two destinations for the same dataset", () => {
    const copy = defineTailorDBReplicationDestination("warehouse-copy", {
      bigquery: { project: "acme-analytics", dataset: "tailor" },
    });

    expect(() =>
      defineApplication({ config: configOf({ dbReplicationDestinations: [warehouse, copy] }) }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'dbReplicationDestinations.1.bigquery: Destination "warehouse-copy" writes to the same dataset as destination "warehouse"',
        ),
      }),
    );
  });

  test("rejects one replication name in two namespaces", () => {
    expect(() =>
      defineApplication({
        config: configOf({
          db: {
            "main-db": { files: [], replications: { analytics: { destination: warehouse } } },
            "order-db": { files: [], replications: { analytics: { destination: warehouse } } },
          },
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'db.order-db.replications.analytics: Replication "analytics" is also declared by TailorDB namespace "main-db"',
        ),
      }),
    );
  });
});

describe("loadApplication TailorDB replication tables", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  function load(replication: string, replications: NonNullable<AppConfig["db"]>[string]) {
    // Inside the SDK package, so the table file resolves `@tailor-platform/sdk`.
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".replication-")));
    fs.writeFileSync(
      path.join(tmpDir, "user.ts"),
      `
import { db, unsafeAllowAllGqlPermission, unsafeAllowAllTypePermission } from "@tailor-platform/sdk";

export const user = db
  .table("User", {
    name: db.string(),
    email: db.string(),
    embedding: db.string().vector(),
  })
  .permission(unsafeAllowAllTypePermission)
  .gqlPermission(unsafeAllowAllGqlPermission)
  ${replication};
`,
    );
    return loadApplication({
      config: configOf(
        { db: { "main-db": { ...replications, files: [path.join(tmpDir, "user.ts")] } } },
        tmpDir,
      ),
    });
  }

  const both = {
    files: [],
    replications: {
      analytics: { destination: warehouse },
      lake: { destination: warehouse, tablePrefix: "lake_" },
    },
  };

  test("adds a table without targets to every replication of the namespace", async () => {
    const { application } = await load('.replication({ excludeFields: ["email"] })', both);

    expect(application.dbReplications.map(({ name, types }) => ({ name, types }))).toEqual([
      { name: "analytics", types: [{ name: "User", excludeFields: ["email"] }] },
      { name: "lake", types: [{ name: "User", excludeFields: ["email"] }] },
    ]);
  });

  test("adds a table to the replications it targets, with their fields", async () => {
    const { application } = await load(
      '.replication({ targets: ["analytics"], includeFields: ["name"] }, { targets: ["lake"] })',
      both,
    );

    expect(application.dbReplications.map(({ name, types }) => ({ name, types }))).toEqual([
      { name: "analytics", types: [{ name: "User", includeFields: ["name"] }] },
      { name: "lake", types: [{ name: "User" }] },
    ]);
  });

  test("accepts a target the namespace declares but does not deploy", async () => {
    const { application } = await load('.replication({ targets: ["lake"] })', {
      files: [],
      replications: { analytics: { destination: warehouse }, lake: undefined },
    });

    expect(application.dbReplications.map(({ name, types }) => ({ name, types }))).toEqual([
      { name: "analytics", types: [] },
    ]);
  });

  test("leaves a table without .replication() out", async () => {
    const { application } = await load("", both);

    expect(application.dbReplications.every(({ types }) => types.length === 0)).toBe(true);
  });

  test.each([
    {
      title: "a target the namespace does not declare",
      replication: '.replication({ targets: ["archive"] })',
      issue:
        'db.main-db.tables.User.replication.0.targets: Table "User" names replication "archive", which TailorDB namespace "main-db" does not declare in replications',
    },
    {
      title: "one replication set twice",
      replication: '.replication({}, { targets: ["lake"] })',
      issue:
        'db.main-db.tables.User.replication.1: Table "User" sets replication "lake" more than once',
    },
    {
      title: "a field the table does not have",
      replication: '.replication({ excludeFields: ["phone"] })',
      issue:
        'db.main-db.tables.User.replication.0.excludeFields.0: Table "User" has no field "phone" to replicate',
    },
    {
      title: "a vector field in includeFields",
      replication: '.replication({ includeFields: ["embedding"] })',
      issue:
        'db.main-db.tables.User.replication.0.includeFields.0: Field "User.embedding" is a vector field, which is not replicated',
    },
  ])("rejects $title", async ({ replication, issue }) => {
    await expect(load(replication, both)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringContaining(issue),
    });
  });
});
