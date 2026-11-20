import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";
import { db } from "#/configure/services/tailordb/schema";
import { parseTypes } from "#/parser/service/tailordb/index";
import { toSchemaOutput } from "#/utils/test/internal";
import { generateContentMappedKyselyTypes } from "./type-processor";
import type { TailorAnyDBType } from "#/configure/services/tailordb/types";

const SDK_ROOT = join(import.meta.dirname, "..", "..", "..", "..");

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tablesOf(namespace: string, type: TailorAnyDBType) {
  const schema = toSchemaOutput(type);
  return parseTypes({ [schema.name]: schema }, namespace, {});
}

async function diagnosticsFor(usage: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "tailor-create-scoped-get-db-"));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, "db.ts"),
    await generateContentMappedKyselyTypes(
      [
        {
          namespace: "customer-db",
          tables: tablesOf("customer-db", db.table("Customer", { name: db.string() })),
        },
        {
          namespace: "order-db",
          tables: tablesOf("order-db", db.table("Order", { total: db.int() })),
        },
      ],
      false,
    ),
  );
  const fileName = join(dir, "case.ts");
  writeFileSync(fileName, `import { createScopedGetDB } from "./db";\n${usage}`);

  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { "@tailor-platform/sdk/kysely": [join(SDK_ROOT, "src", "kysely", "index.ts")] },
    },
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
}

// Each case compiles the generated module through ts.createProgram, which takes seconds under load.
describe("createScopedGetDB of the content-mapped Kysely types", { timeout: 60_000 }, () => {
  test("gives a getDB that reads the tables of the namespaces it names", async () => {
    expect(
      await diagnosticsFor(`
const getDB = createScopedGetDB<"customer-db">();
getDB("customer-db").selectFrom("Customer").select("name");
`),
    ).toEqual([]);
  });

  test("rejects a namespace the type argument leaves out", async () => {
    expect(
      await diagnosticsFor(`
const getDB = createScopedGetDB<"customer-db">();
getDB("order-db");
`),
    ).toEqual([expect.stringContaining('"order-db"')]);
  });

  test("rejects a table of a namespace the type argument leaves out", async () => {
    expect(
      await diagnosticsFor(`
const getDB = createScopedGetDB<"customer-db">();
getDB("customer-db").selectFrom("Order");
`),
    ).toEqual([expect.stringContaining('"Order"')]);
  });

  test("gives a getDB that accepts no namespace without a type argument", async () => {
    expect(
      await diagnosticsFor(`
const getDB = createScopedGetDB();
getDB("customer-db");
`),
    ).toEqual([expect.stringContaining('"customer-db"')]);
  });

  test("rejects a type argument that names no namespace", async () => {
    expect(
      await diagnosticsFor(`
createScopedGetDB<"missing-db">();
`),
    ).toEqual([expect.stringContaining('"missing-db"')]);
  });
});
