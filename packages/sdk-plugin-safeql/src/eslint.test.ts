import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSchemaDDL, type DDLTableConfig } from "@tailor-platform/sdk/plugin";
import { ESLint } from "eslint";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { tailorSafeqlConfig } from "./eslint";
import { columnTypeOverrides } from "./overrides";

const tables: DDLTableConfig[] = [
  {
    name: "Account",
    fields: {
      id: { type: "uuid", required: true },
      email: { type: "string", required: true },
      age: { type: "integer", required: true },
      role: {
        type: "enum",
        required: true,
        allowedValues: [{ value: "ADMIN" }, { value: "MEMBER" }],
      },
    },
  },
  {
    name: "Project",
    fields: {
      id: { type: "uuid", required: true },
      ownerId: { type: "uuid", required: true },
      title: { type: "string", required: true },
    },
  },
];

const sourceEntry = fileURLToPath(new URL("./index.ts", import.meta.url));

let directory: string;
let eslint: ESLint;

async function messagesFor(source: string): Promise<string[]> {
  const file = join(directory, "query.ts");
  await writeFile(file, source);
  const [result] = await eslint.lintText(source, { filePath: file });
  return result!.messages.map(({ message }) => message.replace(/\n\s*/g, " "));
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "safeql-e2e-"));
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        skipLibCheck: true,
        types: [],
        noEmit: true,
        paths: { "@tailor-platform/sdk-plugin-safeql": [sourceEntry] },
      },
      include: ["*.ts"],
    }),
  );
  await writeFile(join(directory, "query.ts"), "export {};\n");
  eslint = new ESLint({
    cwd: directory,
    overrideConfigFile: true,
    overrideConfig: tailorSafeqlConfig({
      ddl: generateSchemaDDL(tables),
      overrides: { columns: columnTypeOverrides(tables) },
    }),
  });
}, 60_000);

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const header = `import { sql } from "@tailor-platform/sdk-plugin-safeql";\n`;

describe("tailorSafeqlConfig", { timeout: 60_000 }, () => {
  test("infers an enum column as the union of its allowed values", async () => {
    const messages = await messagesFor(
      `${header}export const q = sql\`SELECT "email", "role" FROM "Account"\`;\n`,
    );
    expect(messages).toEqual([
      "Query is missing type annotation Fix with: { email: string; role: 'ADMIN' | 'MEMBER' }",
    ]);
  });

  test("infers a column from the outer side of a LEFT JOIN as nullable", async () => {
    const messages = await messagesFor(
      `${header}export const q = sql\`SELECT p."title", a."role" FROM "Project" p LEFT JOIN "Account" a ON a."id" = p."ownerId"\`;\n`,
    );
    expect(messages).toEqual([
      "Query is missing type annotation Fix with: { title: string; role: 'ADMIN' | 'MEMBER' | null }",
    ]);
  });

  test("reports a column that does not exist", async () => {
    const messages = await messagesFor(
      `${header}export const q = sql\`SELECT "emali" FROM "Account"\`;\n`,
    );
    expect(messages).toEqual(['Invalid Query: column "emali" does not exist']);
  });

  test("reports a string variable compared with a numeric column", async () => {
    const messages = await messagesFor(
      `${header}export function find(age: string) { return sql\`SELECT "email" FROM "Account" WHERE "age" > \${age}\`; }\n`,
    );
    expect(messages).toEqual(["Invalid Query: operator does not exist: integer > text"]);
  });

  test("accepts a statement whose row type is annotated correctly", async () => {
    const messages = await messagesFor(
      `${header}export function find(age: number) { return sql<{ email: string }>\`SELECT "email" FROM "Account" WHERE "age" > \${age}\`; }\n`,
    );
    expect(messages).toEqual([]);
  });
});
