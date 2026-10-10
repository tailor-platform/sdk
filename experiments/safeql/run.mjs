import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { rules } from "@ts-safeql/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import { ESLint } from "eslint";
import { db } from "../../packages/sdk/src/configure/services/tailordb/index.ts";
import { ddlFromTables } from "./ddl.mjs";
import { account, parseTables, project } from "./schema.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
const resultsDirectory = join(directory, "results");
const cacheDirectory = join(directory, "node_modules", ".cache");
await mkdir(resultsDirectory, { recursive: true });
await mkdir(cacheDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(cacheDirectory, "safeql-poc-"));
const compiler = join(directory, "node_modules", ".bin", "tsc");
const typeOverrides = { int8: "number" };
const report = [];
let failures = 0;

function createEslint(ddlPath, fix) {
  return new ESLint({
    cwd: temporaryDirectory,
    overrideConfigFile: true,
    fix,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            project: join(temporaryDirectory, "tsconfig.json"),
            tsconfigRootDir: temporaryDirectory,
          },
        },
        plugins: { "@ts-safeql": { rules } },
        rules: {
          "@ts-safeql/check-sql": [
            "error",
            {
              connections: [
                {
                  plugins: [{ package: join(directory, "pglite-plugin.mjs"), config: { ddlPath } }],
                  overrides: { types: typeOverrides },
                  targets: [{ tag: "sql" }],
                },
              ],
            },
          ],
        },
      },
    ],
  });
}

async function lint(eslint, file, source) {
  const [result] = await eslint.lintText(source, { filePath: file });
  const messages = result.messages.map(({ message }) => message.replace(/\n\s*/g, " "));
  const parseError = messages.find((message) => message.startsWith("Parsing error"));
  if (parseError) throw new Error(`${file}: ${parseError}`);
  return { messages, output: result.output };
}

async function typeCheck(files) {
  const project = join(temporaryDirectory, "tsconfig.check.json");
  await writeFile(project, JSON.stringify({ extends: "./tsconfig.json", include: [], files }));
  const run = spawnSync(compiler, ["--project", project, "--pretty", "false"], {
    encoding: "utf8",
  });
  return {
    exitCode: run.status,
    output: run.stdout
      .replaceAll(temporaryDirectory, "<temporary>")
      .replaceAll(relative(directory, temporaryDirectory), "<temporary>")
      .trim(),
  };
}

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

const missingAnnotation = /Query is missing type annotation/;
const invalidQuery = /^Invalid Query: /;

const cases = [
  { name: "scalars", detected: "none" },
  { name: "left-join", detected: "none" },
  { name: "inner-join", detected: "none" },
  { name: "parameters", detected: "none" },
  { name: "unknown-column", detected: "sql-analysis", diagnostic: /column "emali" does not exist/ },
  {
    name: "unknown-table",
    detected: "sql-analysis",
    diagnostic: /relation "MissingAccount" does not exist/,
  },
  {
    name: "wrong-parameter",
    detected: "sql-analysis",
    diagnostic: /invalid input syntax for type bigint: "eighteen"/,
  },
  {
    name: "wrong-enum",
    detected: "sql-analysis",
    diagnostic: /invalid input value for enum "Account.role": "OWNER"/,
  },
  {
    name: "typed-parameter-wrong",
    detected: "sql-analysis",
    diagnostic: /operator does not exist: bigint > text/,
  },
  {
    name: "typed-enum-wrong",
    detected: "sql-analysis",
    diagnostic: /operator does not exist: "Account.role" = text/,
  },
  { name: "typed-enum-ok", detected: "none" },
  { name: "unsafe-null", detected: "tsc", diagnostic: /possibly 'null'/ },
  {
    name: "cte-postgres-only",
    detected: "none",
    limitation: "PostgreSQL accepts this CTE; this is not TailorDB compatibility validation.",
  },
];

try {
  const setupStarted = performance.now();
  const tables = parseTables([account, project], "poc");
  const ddl = ddlFromTables(tables);
  const ddlPath = join(temporaryDirectory, "schema.sql");
  await writeFile(ddlPath, ddl);
  await writeFile(join(resultsDirectory, "poc.schema.sql"), ddl);
  await copyFile(join(directory, "fixtures", "_sql.ts.txt"), join(temporaryDirectory, "sql.ts"));
  await writeFile(
    join(temporaryDirectory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
        noEmit: true,
      },
      include: ["*.ts"],
    }),
  );
  const fixtureNames = (await readdir(join(directory, "fixtures")))
    .filter((file) => !file.startsWith("_"))
    .map((file) => file.replace(".ts.txt", ""));
  assert.deepEqual(fixtureNames.sort(), cases.map(({ name }) => name).sort());
  for (const name of fixtureNames) {
    await copyFile(
      join(directory, "fixtures", `${name}.ts.txt`),
      join(temporaryDirectory, `${name}.ts`),
    );
  }

  const check = createEslint(ddlPath, false);
  const fixer = createEslint(ddlPath, true);

  const scalarsFile = join(temporaryDirectory, "scalars.ts");
  const firstStarted = performance.now();
  await lint(check, scalarsFile, await readFile(scalarsFile, "utf8"));
  const coldStartMs = Math.round(performance.now() - setupStarted);
  const firstLintMs = Math.round(performance.now() - firstStarted);

  for (const testCase of cases) {
    const file = join(temporaryDirectory, `${testCase.name}.ts`);
    const source = await readFile(file, "utf8");
    const started = performance.now();
    const detection = await lint(check, file, source);
    const fixed = await lint(fixer, file, source);
    const sqlErrors = detection.messages.filter((message) => invalidQuery.test(message));
    const annotation = detection.messages.find((message) => missingAnnotation.test(message));
    const details = {
      expectedDetectionPoint: testCase.detected,
      ...(testCase.limitation ? { limitation: testCase.limitation } : {}),
      lintMessages: detection.messages,
      elapsedMs: 0,
    };
    let tsc;
    let relint;
    if (fixed.output !== undefined) {
      const fixedFile = join(temporaryDirectory, `${testCase.name}.fixed.ts`);
      await writeFile(fixedFile, fixed.output);
      await writeFile(join(resultsDirectory, `${testCase.name}.fixed.ts.txt`), fixed.output);
      relint = await lint(check, file, fixed.output);
      tsc = await typeCheck([fixedFile, join(temporaryDirectory, "sql.ts")]);
      details.relintMessages = relint.messages;
      details.typeScript = tsc;
    }
    details.elapsedMs = Math.round(performance.now() - started);
    record(testCase.name, details, () => {
      if (testCase.detected === "sql-analysis") {
        assert.ok(
          sqlErrors.some((message) => testCase.diagnostic.test(message)),
          detection.messages.join("\n"),
        );
        assert.equal(fixed.output, undefined);
      } else {
        assert.equal(sqlErrors.length, 0, detection.messages.join("\n"));
        assert.ok(annotation, "expected an autofixable annotation");
        assert.deepEqual(relint.messages, []);
        if (testCase.detected === "tsc") {
          assert.notEqual(tsc.exitCode, 0);
          assert.match(tsc.output, testCase.diagnostic);
        } else {
          assert.equal(tsc.exitCode, 0, tsc.output);
        }
      }
      if (testCase.name === "left-join") {
        assert.match(fixed.output, /sql<\{[^}]*title: string \| null[^}]*budget: string \| null/);
      }
      if (testCase.name === "scalars") {
        assert.match(fixed.output, /age: number/);
        assert.match(fixed.output, /role: 'ADMIN' \| 'MEMBER'/);
      }
    });

    if (testCase.name === "wrong-parameter") {
      const baseline = await typeCheck([file, join(temporaryDirectory, "sql.ts")]);
      record("untransformed-wrong-parameter", baseline, () => {
        assert.equal(baseline.exitCode, 0, baseline.output);
      });
    }
  }

  const changedTables = structuredClone(tables);
  delete changedTables.Account.fields.email;
  const changedDdlPath = join(temporaryDirectory, "changed.sql");
  await writeFile(changedDdlPath, ddlFromTables(changedTables));
  const removedColumnSource =
    'import { sql } from "./sql";\nexport const q = sql`SELECT "email" FROM "Account"`;\n';
  const removedColumn = await lint(
    createEslint(changedDdlPath, false),
    scalarsFile,
    removedColumnSource,
  );
  record("removed-sdk-column", { lintMessages: removedColumn.messages }, () => {
    assert.ok(
      removedColumn.messages.some((message) => /column "email" does not exist/.test(message)),
    );
  });

  const overwrittenDdlPath = join(temporaryDirectory, "overwritten.sql");
  await writeFile(overwrittenDdlPath, ddl);
  const overwriteEslint = createEslint(overwrittenDdlPath, false);
  const beforeOverwrite = await lint(overwriteEslint, scalarsFile, removedColumnSource);
  await writeFile(overwrittenDdlPath, ddlFromTables(changedTables));
  const afterOverwrite = await lint(overwriteEslint, scalarsFile, removedColumnSource);
  record(
    "schema-overwritten-at-same-path",
    { before: beforeOverwrite.messages, after: afterOverwrite.messages },
    () => {
      assert.ok(!beforeOverwrite.messages.some((message) => invalidQuery.test(message)));
      assert.ok(
        afterOverwrite.messages.some((message) => /column "email" does not exist/.test(message)),
        afterOverwrite.messages.join("\n"),
      );
    },
  );

  record("unsupported-nested-field", {}, () => {
    const nestedTables = {
      Account: { name: "Account", fields: { profile: { config: { type: "nested", fields: {} } } } },
    };
    assert.throws(() => ddlFromTables(nestedTables), /arrays\/nested fields/);
  });

  const enumDdlPath = join(temporaryDirectory, "enums.sql");
  await writeFile(
    enumDdlPath,
    ddlFromTables(
      parseTables(
        [
          db.table("Order_Item", { status: db.enum(["A"]) }),
          db.table("Order", { Item_Status: db.enum(["B"]) }),
        ],
        "poc",
      ),
    ),
  );
  const enumFixer = createEslint(enumDdlPath, true);
  for (const [table, column, value] of [
    ["Order_Item", "status", "A"],
    ["Order", "Item_Status", "B"],
  ]) {
    const result = await lint(
      enumFixer,
      scalarsFile,
      `import { sql } from "./sql";\nexport const q = sql\`SELECT "${column}" FROM "${table}" WHERE "${column}" = \${"${value}"}\`;\n`,
    );
    record(`distinct-enums-${table}.${column}`, { fixedSource: result.output }, () => {
      assert.match(result.output ?? "", new RegExp(`${column}: '${value}'`));
    });
  }

  const iterations = 20;
  const warmStarted = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const warm = await lint(
      check,
      scalarsFile,
      `import { sql } from "./sql";\nconst minimumAge = ${i};\nexport const q = sql\`SELECT "email" AS "email${i}", "age" FROM "Account" WHERE "age" >= \${minimumAge}\`;\n`,
    );
    assert.match(warm.messages[0] ?? "", /Fix with: \{ 'email\d+': string; age: number \}/);
  }
  const averageLintMs = (performance.now() - warmStarted) / iterations;
  const summary = {
    node: process.version,
    safeql: "5.4.1",
    typescript: spawnSync(compiler, ["--version"], { encoding: "utf8" }).stdout.trim(),
    databaseExecuted: "PGlite (embedded PostgreSQL, in-process, DDL only; no server install)",
    dialect: "PostgreSQL (PGlite) with SDK-derived DDL; not TailorDB",
    typeOverrides,
    passed: report.length - failures,
    failed: failures,
    coldStartMs,
    firstLintMs,
    averageWarmLintMs: Math.round(averageLintMs * 10) / 10,
    cases: report,
  };
  await writeFile(join(resultsDirectory, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `\n${summary.passed}/${report.length} checks passed; cold start ${coldStartMs} ms; warm lint ${summary.averageWarmLintMs} ms/file (${iterations} iterations, distinct queries).`,
  );
  console.log(`Results: ${resultsDirectory}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

process.exit(failures > 0 ? 1 : 0);
