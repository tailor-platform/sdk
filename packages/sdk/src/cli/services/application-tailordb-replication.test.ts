import * as fs from "node:fs";
import * as path from "pathe";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { defineConfig } from "#/configure/config/index";
import {
  defineTailorDBReplication,
  defineTailorDBReplicationDestination,
} from "#/configure/services/tailordb-replication/index";
import { db } from "#/configure/services/tailordb/schema";
import { defineApplication, loadApplication } from "./application";
import type { AppConfig } from "#/configure/config/types";

const warehouse = defineTailorDBReplicationDestination("warehouse", {
  bigquery: { project: "acme-analytics", dataset: "tailor" },
});

const user = db.table("User", {
  name: db.string(),
  email: db.string(),
  embedding: db.string().vector(),
});

function configOf(
  overrides: Partial<
    Pick<AppConfig, "db" | "tailordbReplicationDestinations" | "tailordbReplications">
  >,
  dir = "/project",
) {
  return {
    ...defineConfig({ name: "shop", ...overrides }),
    path: path.join(dir, "tailor.config.ts"),
  };
}

describe("defineApplication TailorDB replications", () => {
  test("parses destinations and replications, enabling a replication by default", () => {
    const replication = defineTailorDBReplication("analytics", {
      source: { namespace: "main-db" },
      destination: "warehouse",
      tablePrefix: "shop_",
    }).add(user, { excludeFields: ["email"] });

    const application = defineApplication({
      config: configOf({
        tailordbReplicationDestinations: [warehouse],
        tailordbReplications: [replication],
      }),
    });

    expect(application.tailordbReplicationDestinations).toEqual([
      { name: "warehouse", bigquery: { project: "acme-analytics", dataset: "tailor" } },
    ]);
    expect(application.tailordbReplications).toEqual([
      {
        name: "analytics",
        source: { namespace: "main-db" },
        destination: "warehouse",
        tablePrefix: "shop_",
        enabled: true,
        types: [{ name: "User", excludeFields: ["email"] }],
      },
    ]);
  });

  test("rejects a replication whose destination is not listed", () => {
    const replication = defineTailorDBReplication("analytics", {
      source: { namespace: "main-db" },
      destination: "lake",
    });

    expect(() =>
      defineApplication({ config: configOf({ tailordbReplications: [replication] }) }),
    ).toThrow(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        message: expect.stringContaining(
          'tailordbReplications.0.destination: Destination "lake" is not in tailordbReplicationDestinations',
        ),
      }),
    );
  });

  test("rejects two destinations for the same dataset", () => {
    const copy = defineTailorDBReplicationDestination("warehouse-copy", {
      bigquery: { project: "acme-analytics", dataset: "tailor" },
    });

    expect(() =>
      defineApplication({
        config: configOf({ tailordbReplicationDestinations: [warehouse, copy] }),
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'tailordbReplicationDestinations.1.bigquery: Destination "warehouse-copy" writes to the same dataset as destination "warehouse"',
        ),
      }),
    );
  });

  test("rejects two replications with the same name", () => {
    const replication = defineTailorDBReplication("analytics", {
      source: { namespace: "main-db" },
      destination: "warehouse",
    });

    expect(() =>
      defineApplication({
        config: configOf({
          tailordbReplicationDestinations: [warehouse],
          tailordbReplications: [replication, replication],
        }),
      }),
    ).toThrow(expect.objectContaining({ code: "DEFINITION_NAME_DUPLICATE" }));
  });

  test("rejects a type listing both excludeFields and includeFields", () => {
    const replication = defineTailorDBReplication("analytics", {
      source: { namespace: "main-db" },
      destination: "warehouse",
    }).add(user, { excludeFields: ["email"], includeFields: ["name"] } as never);

    expect(() =>
      defineApplication({
        config: configOf({
          tailordbReplicationDestinations: [warehouse],
          tailordbReplications: [replication],
        }),
      }),
    ).toThrow(
      expect.objectContaining({
        code: "CONFIG_INVALID",
        message: expect.stringContaining(
          "Specify either `excludeFields` or `includeFields`, not both.",
        ),
      }),
    );
  });
});

describe("loadApplication TailorDB replication sources", () => {
  let tmpDir: string;

  beforeAll(() => {
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
  .gqlPermission(unsafeAllowAllGqlPermission);
`,
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function load(replication: ReturnType<typeof defineTailorDBReplication>) {
    return loadApplication({
      config: configOf(
        {
          db: {
            "main-db": { files: [path.join(tmpDir, "user.ts")] },
            "shared-db": { external: true },
          },
          tailordbReplicationDestinations: [warehouse],
          tailordbReplications: [replication],
        },
        tmpDir,
      ),
    });
  }

  const base = (namespace = "main-db") =>
    defineTailorDBReplication("analytics", { source: { namespace }, destination: "warehouse" });

  test("accepts types the namespace loads, with their fields", async () => {
    const { application } = await load(base().add(user, { includeFields: ["name", "email"] }));

    expect(application.tailordbReplications[0]?.types).toEqual([
      { name: "User", includeFields: ["name", "email"] },
    ]);
  });

  test.each([
    {
      title: "a namespace not in db",
      replication: base("other-db"),
      issue:
        'tailordbReplications.0.source.namespace: TailorDB namespace "other-db" is not configured in db',
    },
    {
      title: "an external namespace",
      replication: base("shared-db"),
      issue:
        'tailordbReplications.0.source.namespace: TailorDB namespace "shared-db" is external; replicate it from the config that defines it',
    },
    {
      title: "a type the namespace does not load",
      replication: base().add(db.table("Order", { total: db.int() })),
      issue:
        'tailordbReplications.0.types.0.name: Type "Order" is not loaded by the files of TailorDB namespace "main-db"',
    },
    {
      title: "a type added twice",
      replication: base().add(user).add(user),
      issue:
        'tailordbReplications.0.types.1.name: Type "User" is added to the replication more than once',
    },
    {
      title: "a field the type does not have",
      replication: base().add(user, { excludeFields: ["phone"] } as never),
      issue:
        'tailordbReplications.0.types.0.excludeFields.0: Type "User" has no field "phone" to replicate',
    },
    {
      title: "a vector field in includeFields",
      replication: base().add(user, { includeFields: ["embedding"] } as never),
      issue:
        'tailordbReplications.0.types.0.includeFields.0: Field "User.embedding" is a vector field, which is not replicated',
    },
  ])("rejects $title", async ({ replication, issue }) => {
    await expect(load(replication)).rejects.toMatchObject({
      code: "CONFIG_INVALID",
      message: expect.stringContaining(issue),
    });
  });

  test("accepts a vector field in excludeFields", async () => {
    await expect(load(base().add(user, { excludeFields: ["embedding"] }))).resolves.toBeDefined();
  });
});
