import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import { backfillSeedIds } from "./index";

let tempDir: string | undefined;

// Mirrors a generated `<Type>.schema.ts`: the hook mints an id, computes
// derived fields, and normalizes omitted optional fields to null.
const customerSchema = `
export const schema = {
  "~standard": {
    version: 1,
    vendor: "backfill-test",
    validate(value) {
      if (!value.name) {
        return { issues: [{ message: "name is required" }] };
      }
      return {
        value: {
          ...value,
          id: value.id ?? crypto.randomUUID(),
          phone: value.phone ?? null,
          createdAt: value.createdAt ?? new Date().toISOString(),
        },
      };
    },
  },
};
`;

// Mirrors the generated `_User.schema.ts`: no id field, name as primary key.
const userSchema = `
export const schema = {
  primaryKey: "name",
  "~standard": {
    version: 1,
    vendor: "backfill-test",
    validate: (value) => ({ value }),
  },
};
`;

function makeDataDir(files: Record<string, string>): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "seed-backfill-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(tempDir, name), content);
  }
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("backfillSeedIds", () => {
  test("backfills ids without materializing hook-computed or omitted fields", async () => {
    const withId = '{"id":"existing-id","name":"Acme","email":"a@acme.com","phone":"03-1234"}';
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": `${withId}\n{"name":"Globex","email":"g@globex.com"}\n`,
    });

    const result = await backfillSeedIds({ path: dir });

    expect(result.backfilled).toEqual({ Customer: 1 });
    expect(result.output).toBe("✓ Customer: 1 id backfilled");

    const lines = readFileSync(path.join(dir, "Customer.jsonl"), "utf-8").trim().split("\n");
    expect(lines[0]).toBe(withId);

    const backfilledRow = JSON.parse(lines[1] ?? "");
    expect(backfilledRow.id).toMatch(UUID_PATTERN);
    expect(backfilledRow).toEqual({
      id: backfilledRow.id,
      name: "Globex",
      email: "g@globex.com",
    });
  });

  test("counts an explicit null id as missing", async () => {
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": '{"id":null,"name":"Acme","email":"a@acme.com"}\n',
    });

    const result = await backfillSeedIds({ path: dir });

    expect(result.backfilled).toEqual({ Customer: 1 });
    const row = JSON.parse(readFileSync(path.join(dir, "Customer.jsonl"), "utf-8").trim());
    expect(row.id).toMatch(UUID_PATTERN);
  });

  test("leaves tables without an id field untouched", async () => {
    const userLines = '{"name":"john@example.com","password":"Password1!"}\n';
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": '{"name":"Acme","email":"a@acme.com"}\n',
      "_User.schema.ts": userSchema,
      "_User.jsonl": userLines,
    });

    const result = await backfillSeedIds({ path: dir });

    expect(result.backfilled).toEqual({ Customer: 1 });
    expect(readFileSync(path.join(dir, "_User.jsonl"), "utf-8")).toBe(userLines);
  });

  test("does not rewrite files when every row already has an id", async () => {
    const content = '{"id":"existing-id","name":"Acme","email":"a@acme.com"}\n';
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": content,
    });

    const result = await backfillSeedIds({ path: dir });

    expect(result.backfilled).toEqual({});
    expect(result.output).toBe("✓ All rows already have an id");
    expect(readFileSync(path.join(dir, "Customer.jsonl"), "utf-8")).toBe(content);
  });

  test("rejects invalid seed data without touching the files", async () => {
    const content = '{"email":"no-name@acme.com"}\n{"name":"Acme","email":"a@acme.com"}\n';
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": content,
    });

    await expect(backfillSeedIds({ path: dir })).rejects.toThrow(
      /Seed data failed validation; fix the errors and re-run\./,
    );
    expect(readFileSync(path.join(dir, "Customer.jsonl"), "utf-8")).toBe(content);
  });

  test("backfills a table named __proto__", async () => {
    const dir = makeDataDir({
      "__proto__.schema.ts": customerSchema,
      "__proto__.jsonl": '{"name":"Acme","email":"a@acme.com"}\n',
    });

    const result = await backfillSeedIds({ path: dir });

    expect(result.backfilled).toEqual(Object.fromEntries([["__proto__", 1]]));
    const row = JSON.parse(readFileSync(path.join(dir, "__proto__.jsonl"), "utf-8").trim());
    expect(row.id).toMatch(UUID_PATTERN);
  });

  test("does not rewrite other tables' files when backfilling", async () => {
    const spacedUserLines = '{"name": "john@example.com", "password": "Password1!"}\n\n';
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": '{"name":"Acme","email":"a@acme.com"}\n',
      "_User.schema.ts": userSchema,
      "_User.jsonl": spacedUserLines,
    });

    await backfillSeedIds({ path: dir });

    expect(readFileSync(path.join(dir, "_User.jsonl"), "utf-8")).toBe(spacedUserLines);
  });

  test("rejects a table whose schema file is missing", async () => {
    const content = '{"name":"Acme","email":"a@acme.com"}\n';
    const dir = makeDataDir({ "Customer.jsonl": content });

    await expect(backfillSeedIds({ path: dir })).rejects.toThrow(
      /Schema file not found for table 'Customer'/,
    );
    expect(readFileSync(path.join(dir, "Customer.jsonl"), "utf-8")).toBe(content);
  });

  test("rejects a table whose schema file fails to load", async () => {
    const content = '{"name":"Acme","email":"a@acme.com"}\n';
    const dir = makeDataDir({
      "Customer.schema.ts": 'throw new Error("broken schema");\n',
      "Customer.jsonl": content,
    });

    await expect(backfillSeedIds({ path: dir })).rejects.toThrow(
      /Failed to load schema for table 'Customer'/,
    );
    expect(readFileSync(path.join(dir, "Customer.jsonl"), "utf-8")).toBe(content);
  });

  test("rejects a file path", async () => {
    const dir = makeDataDir({
      "Customer.schema.ts": customerSchema,
      "Customer.jsonl": '{"name":"Acme","email":"a@acme.com"}\n',
    });
    const filePath = path.join(dir, "Customer.jsonl");

    await expect(backfillSeedIds({ path: filePath })).rejects.toThrow(
      `Invalid path: ${filePath}. Must be a directory.`,
    );
  });
});
