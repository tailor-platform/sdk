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

interface Project {
  messagesFor(source: string): Promise<string[]>;
  remove(): Promise<void>;
}

async function createProject(projectTables: DDLTableConfig[]): Promise<Project> {
  const directory = await mkdtemp(join(tmpdir(), "safeql-e2e-"));
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
  const eslint = new ESLint({
    cwd: directory,
    overrideConfigFile: true,
    overrideConfig: tailorSafeqlConfig({
      ddl: generateSchemaDDL(projectTables),
      overrides: { columns: columnTypeOverrides(projectTables) },
    }),
  });
  return {
    async messagesFor(source) {
      const file = join(directory, "query.ts");
      await writeFile(file, source);
      const [result] = await eslint.lintText(source, { filePath: file });
      return result!.messages.map(({ message }) => message.replace(/\n\s*/g, " "));
    },
    remove: () => rm(directory, { recursive: true, force: true }),
  };
}

let project: Project;

beforeAll(async () => {
  project = await createProject(tables);
}, 60_000);

afterAll(async () => {
  await project.remove();
});

const header = `import { sql } from "@tailor-platform/sdk-plugin-safeql";\n`;

describe("tailorSafeqlConfig", { timeout: 60_000 }, () => {
  test("infers an enum column as the union of its allowed values", async () => {
    const messages = await project.messagesFor(
      `${header}export const q = sql\`SELECT "email", "role" FROM "Account"\`;\n`,
    );
    expect(messages).toEqual([
      "Query is missing type annotation Fix with: { email: string; role: 'ADMIN' | 'MEMBER' }",
    ]);
  });

  test("infers a column from the outer side of a LEFT JOIN as nullable", async () => {
    const messages = await project.messagesFor(
      `${header}export const q = sql\`SELECT p."title", a."role" FROM "Project" p LEFT JOIN "Account" a ON a."id" = p."ownerId"\`;\n`,
    );
    expect(messages).toEqual([
      "Query is missing type annotation Fix with: { title: string; role: 'ADMIN' | 'MEMBER' | null }",
    ]);
  });

  test("reports a column that does not exist", async () => {
    const messages = await project.messagesFor(
      `${header}export const q = sql\`SELECT "emali" FROM "Account"\`;\n`,
    );
    expect(messages).toEqual(['Invalid Query: column "emali" does not exist']);
  });

  test("reports a string variable compared with a numeric column", async () => {
    const messages = await project.messagesFor(
      `${header}export function find(age: string) { return sql\`SELECT "email" FROM "Account" WHERE "age" > \${age}\`; }\n`,
    );
    expect(messages).toEqual(["Invalid Query: operator does not exist: integer > text"]);
  });

  test("accepts a statement whose row type is annotated correctly", async () => {
    const messages = await project.messagesFor(
      `${header}export function find(age: number) { return sql<{ email: string }>\`SELECT "email" FROM "Account" WHERE "age" > \${age}\`; }\n`,
    );
    expect(messages).toEqual([]);
  });
});

function enumField(...values: string[]): DDLTableConfig["fields"][string] {
  return { type: "enum", required: true, allowedValues: values.map((value) => ({ value })) };
}

describe("column types of enum fields", { timeout: 60_000 }, () => {
  let overrides: Project;

  beforeAll(async () => {
    overrides = await createProject([
      { name: "Account", fields: { id: { type: "uuid" }, role: enumField("ADMIN", "MEMBER") } },
      { name: "Team", fields: { id: { type: "uuid" }, role: enumField("OWNER", "GUEST") } },
      { name: "Order_Item", fields: { status: enumField("A", "B") } },
      { name: "Order", fields: { Item_Status: enumField("C") } },
      {
        name: "Doc",
        fields: {
          roles: { type: "enum", array: true, allowedValues: [{ value: "A" }, { value: "B" }] },
        },
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    await overrides.remove();
  });

  test("types columns of the same name in different tables by their own table", async () => {
    const messages = await overrides.messagesFor(
      `${header}export const q = sql\`SELECT a."role" AS "accountRole", t."role" AS "teamRole" FROM "Account" a, "Team" t\`;\n`,
    );
    expect(messages).toEqual([
      "Query is missing type annotation Fix with: { accountRole: 'ADMIN' | 'MEMBER'; teamRole: 'OWNER' | 'GUEST' }",
    ]);
  });

  test("keeps tables whose names would collide when joined with a dot apart", async () => {
    const first = await overrides.messagesFor(
      `${header}export const q = sql\`SELECT "status" FROM "Order_Item"\`;\n`,
    );
    const second = await overrides.messagesFor(
      `${header}export const q = sql\`SELECT "Item_Status" FROM "Order"\`;\n`,
    );
    expect(first).toEqual(["Query is missing type annotation Fix with: { status: 'A' | 'B' }"]);
    expect(second).toEqual(["Query is missing type annotation Fix with: { Item_Status: 'C' }"]);
  });

  test("types an optional enum array column as a nullable array of the union", async () => {
    const messages = await overrides.messagesFor(
      `${header}export const q = sql\`SELECT "roles" FROM "Doc"\`;\n`,
    );
    expect(messages).toEqual([
      "Query is missing type annotation Fix with: { roles: ('A' | 'B')[] | null }",
    ]);
  });
});

describe("tailorSafeqlConfig files", () => {
  const ddl = generateSchemaDDL(tables);

  test("checks every .ts file by default", () => {
    expect(tailorSafeqlConfig({ ddl })[0]?.files).toEqual(["**/*.ts"]);
  });

  test("checks only the given files", () => {
    const [config] = tailorSafeqlConfig({ ddl, files: ["src/resolver/*.ts"] });
    expect(config?.files).toEqual(["src/resolver/*.ts"]);
  });

  test.each(["**/node_modules/**", "**/dist/**", "**/*.d.ts", "**/eslint.config.*"])(
    "never checks files matching %s, which are not part of a project's source",
    (pattern) => {
      expect(tailorSafeqlConfig({ ddl })[0]?.ignores).toContain(pattern);
    },
  );
});
