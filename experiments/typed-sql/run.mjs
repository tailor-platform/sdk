import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { checkFile, compileSource } from "@typed-sql/compiler";
import { postgres } from "@typed-sql/postgres";
import { parseSchemaSnapshot } from "@typed-sql/schema";
import { db } from "../../packages/sdk/src/configure/services/tailordb/index.ts";
import {
  account,
  project,
  parseTables,
  snapshotFromTables,
  typePolicy,
  typedSqlPocPlugin,
} from "./schema.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const resultsDirectory = join(directory, "results");
const cacheDirectory = join(directory, "node_modules", ".cache");
await mkdir(resultsDirectory, { recursive: true });
await mkdir(cacheDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(cacheDirectory, "typed-sql-poc-"));
const compiler = join(directory, "node_modules", ".bin", "tsc");
const dialect = postgres({ typePolicy });
const report = [];
let failures = 0;

const tables = parseTables([account, project], "poc");
const generated = typedSqlPocPlugin().onTailorDBReady({
  tailordb: [{ namespace: "poc", tables }],
});
assert.equal(generated.files.length, 1);
const schema = parseSchemaSnapshot(JSON.parse(generated.files[0].content));
await writeFile(join(resultsDirectory, "poc.schema.json"), generated.files[0].content);

const cases = [
  { name: "scalars", outcome: "pass" },
  { name: "left-join", outcome: "pass" },
  { name: "inner-join", outcome: "pass" },
  { name: "parameters", outcome: "pass" },
  { name: "unknown-column", outcome: "sql-error", diagnostic: /emali/i },
  { name: "unknown-table", outcome: "sql-error", diagnostic: /MissingAccount/i },
  { name: "wrong-parameter", outcome: "ts-error", diagnostic: /TS2345/ },
  { name: "wrong-enum", outcome: "ts-error", diagnostic: /TS2345/ },
  { name: "unsafe-null", outcome: "ts-error", diagnostic: /possibly 'null'/ },
  {
    name: "cte-postgres-only",
    outcome: "pass",
    limitation: "PostgreSQL accepts this CTE; this is not TailorDB compatibility validation.",
  },
];

function record(name, details, verify) {
  try {
    verify();
    report.push({ name, passed: true, ...details });
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    report.push({ name, passed: false, ...details, failure: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

try {
  for (const testCase of cases) {
    const source = await readFile(join(directory, "fixtures", `${testCase.name}.ts.txt`), "utf8");
    const file = join(temporaryDirectory, `${testCase.name}.ts`);
    const projectFile = join(temporaryDirectory, "tsconfig.json");
    await writeFile(file, source);
    await writeFile(
      projectFile,
      JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "NodeNext",
          strict: true,
          skipLibCheck: true,
          types: [],
          noEmit: true,
        },
        files: [file],
      }),
    );
    const started = performance.now();
    const result = await checkFile({ file, schema, dialect, typePolicy, project: projectFile });
    const compiled = compileSource({ source, schema, dialect, typePolicy });
    const sqlErrors = result.sqlDiagnostics.filter(({ severity }) => severity === "error");
    const details = {
      expected: testCase.outcome,
      ok: result.ok,
      ...(testCase.limitation ? { limitation: testCase.limitation } : {}),
      rowType: compiled.queries[0]?.rowType,
      parameterType: compiled.queries[0]?.parameterType,
      sqlDiagnostics: result.sqlDiagnostics,
      typeScript: result.typeScript && {
        exitCode: result.typeScript.exitCode,
        output: result.typeScript.output.replaceAll(temporaryDirectory, "<temporary>"),
      },
      elapsedMs: Math.round(performance.now() - started),
    };
    record(testCase.name, details, () => {
      if (testCase.outcome === "sql-error") {
        assert.equal(result.ok, false);
        assert.ok(sqlErrors.some(({ message }) => testCase.diagnostic.test(message)));
        assert.equal(result.typeScript, undefined);
      } else if (testCase.outcome === "ts-error") {
        assert.equal(sqlErrors.length, 0);
        assert.equal(result.ok, false);
        assert.notEqual(result.typeScript?.exitCode, 0);
        assert.match(result.typeScript?.output ?? "", testCase.diagnostic);
      } else {
        assert.equal(result.ok, true, result.typeScript?.output ?? JSON.stringify(sqlErrors));
        assert.equal(result.typeScript?.exitCode, 0);
        assert.equal(compiled.queries.length, 1);
      }
      if (testCase.name === "left-join") {
        assert.match(compiled.queries[0].rowType, /"title": string \| null/);
        assert.match(compiled.queries[0].rowType, /"budget": string \| null/);
      }
    });
    await writeFile(
      join(resultsDirectory, `${testCase.name}.transformed.ts.txt`),
      result.transformedSource,
    );

    if (testCase.name === "wrong-parameter") {
      const baseline = spawnSync(compiler, ["--project", projectFile, "--pretty", "false"], {
        encoding: "utf8",
      });
      record(
        "untransformed-wrong-parameter",
        { exitCode: baseline.status, output: baseline.stdout },
        () => {
          assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
        },
      );
    }
  }

  const changedTables = structuredClone(tables);
  delete changedTables.Account.fields.email;
  const removedColumn = compileSource({
    source:
      'import { sql } from "@typed-sql/postgres"; const q = sql`SELECT "email" FROM "Account"`;',
    schema: snapshotFromTables(changedTables),
    dialect,
    typePolicy,
  });
  record("removed-sdk-column", { sqlDiagnostics: removedColumn.diagnostics }, () => {
    assert.ok(
      removedColumn.diagnostics.some(
        ({ severity, message }) => severity === "error" && /email/.test(message),
      ),
    );
  });

  record("unsupported-nested-field", {}, () => {
    const nestedTables = {
      Account: { name: "Account", fields: { profile: { config: { type: "nested", fields: {} } } } },
    };
    assert.throws(() => snapshotFromTables(nestedTables), /arrays\/nested fields/);
  });

  record("distinct-enums-with-ambiguous-names", {}, () => {
    const enumSchema = snapshotFromTables(
      parseTables(
        [
          db.table("Order_Item", { status: db.enum(["A"]) }),
          db.table("Order", { Item_Status: db.enum(["B"]) }),
        ],
        "poc",
      ),
    );
    for (const [table, column, value] of [
      ["Order_Item", "status", "A"],
      ["Order", "Item_Status", "B"],
    ]) {
      const compiled = compileSource({
        source: `import { sql } from "@typed-sql/postgres"; const q = sql\`SELECT "${column}" FROM "${table}" WHERE "${column}" = \${"${value}"}\`;`,
        schema: enumSchema,
        dialect,
        typePolicy,
      });
      assert.equal(compiled.diagnostics.length, 0);
      assert.equal(compiled.queries[0].parameterType, `readonly [${JSON.stringify(value)}]`);
    }
  });

  const validSource = await readFile(join(directory, "fixtures", "scalars.ts.txt"), "utf8");
  const iterations = 100;
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1)
    compileSource({ source: validSource, schema, dialect, typePolicy });
  const averageAnalysisMs = (performance.now() - started) / iterations;
  const summary = {
    node: process.version,
    typedSql: "2.1.0",
    typescript: spawnSync(compiler, ["--version"], { encoding: "utf8" }).stdout.trim(),
    databaseExecuted: false,
    dialect:
      "PostgreSQL with SDK-derived catalog and SDK-aligned scalar policy; not a TailorDB dialect",
    passed: report.length - failures,
    failed: failures,
    averageAnalysisMs: Math.round(averageAnalysisMs * 100) / 100,
    cases: report,
  };
  await writeFile(join(resultsDirectory, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `\n${summary.passed}/${report.length} checks passed; analysis ${summary.averageAnalysisMs} ms/query (${iterations} warm iterations).`,
  );
  console.log(`Results: ${resultsDirectory}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (failures > 0) process.exitCode = 1;
