import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
import dbTypeToTableTransform from "../codemods/v2/db-type-to-table/scripts/transform";
import { allCodemods } from "./registry";
import { runCodemods } from "./runner";

const CODEMODS_DIR = path.resolve(__dirname, "../codemods");

const dbTypeToTable = allCodemods.find((codemod) => codemod.id === "v2/db-type-to-table");

if (!dbTypeToTable?.scriptPath) {
  throw new Error("v2/db-type-to-table codemod is not registered with a script");
}

const dbTypeToTableEntry = {
  codemod: dbTypeToTable,
  scriptPath: path.join(CODEMODS_DIR, dbTypeToTable.scriptPath.replace(/\.js$/, ".ts")),
};

describe("db-type-to-table review findings", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  test("does not let switch-case local db declarations shadow imported db outside the switch", () => {
    const input = [
      'import { db } from "@tailor-platform/sdk";',
      "",
      'export const beforeSwitch = db.type("BeforeSwitch", {',
      "  name: db.string(),",
      "});",
      "",
      "switch (kind) {",
      '  case "local":',
      "    const db = { type: (name: string) => name };",
      '    db.type("NoChange");',
      "    break;",
      "}",
      "",
      'export const afterSwitch = db.type("AfterSwitch", {',
      "  name: db.string(),",
      "});",
      "",
    ].join("\n");

    const expected = [
      'import { db } from "@tailor-platform/sdk";',
      "",
      'export const beforeSwitch = db.table("BeforeSwitch", {',
      "  name: db.string(),",
      "});",
      "",
      "switch (kind) {",
      '  case "local":',
      "    const db = { type: (name: string) => name };",
      '    db.type("NoChange");',
      "    break;",
      "}",
      "",
      'export const afterSwitch = db.table("AfterSwitch", {',
      "  name: db.string(),",
      "});",
      "",
    ].join("\n");

    expect(dbTypeToTableTransform(input, "tailordb.ts")).toBe(expected);
  });

  test("reports destructured db.type builders for LLM review", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "db-type-review-test-"));
    await fs.promises.writeFile(
      path.join(tmpDir, "tailordb.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        "",
        "const { type } = db;",
        "",
        'export const user = type("User", {',
        "  name: db.string(),",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await runCodemods([dbTypeToTableEntry], tmpDir, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/db-type-to-table",
        files: ["tailordb.ts"],
        findings: [
          {
            file: "tailordb.ts",
            line: 3,
            message: "Review destructured db.type builder usage and migrate it to db.table.",
            excerpt: "const { type } = db;",
          },
        ],
      }),
    ]);
  });

  test("reports local SDK db aliases for LLM review", async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "db-type-review-test-"));
    await fs.promises.writeFile(
      path.join(tmpDir, "tailordb.ts"),
      [
        'import { db } from "@tailor-platform/sdk";',
        'import * as sdk from "@tailor-platform/sdk";',
        "",
        "const schema = db;",
        "const nsSchema = sdk.db;",
        "const { db: destructuredSchema } = sdk;",
        "const assertedSchema = db as const;",
        "",
        'export const user = schema.type("User", {',
        "  name: schema.string(),",
        "});",
        "",
        'export const team = nsSchema["type"]("Team", {',
        "  name: nsSchema.string(),",
        "});",
        "",
        'export const destructured = destructuredSchema.type("Destructured", {',
        "  name: destructuredSchema.string(),",
        "});",
        "",
        'export const asserted = assertedSchema.type("Asserted", {',
        "  name: assertedSchema.string(),",
        "});",
        "",
      ].join("\n"),
      "utf-8",
    );

    const result = await runCodemods([dbTypeToTableEntry], tmpDir, false);

    expect(result.llmReviews).toEqual([
      expect.objectContaining({
        codemodId: "v2/db-type-to-table",
        files: ["tailordb.ts"],
        findings: [
          {
            file: "tailordb.ts",
            line: 4,
            message: "Review SDK db alias usage and migrate db.type builder calls to db.table.",
            excerpt: "const schema = db;",
          },
          {
            file: "tailordb.ts",
            line: 5,
            message: "Review SDK db alias usage and migrate db.type builder calls to db.table.",
            excerpt: "const nsSchema = sdk.db;",
          },
          {
            file: "tailordb.ts",
            line: 6,
            message: "Review SDK db alias usage and migrate db.type builder calls to db.table.",
            excerpt: "const { db: destructuredSchema } = sdk;",
          },
          {
            file: "tailordb.ts",
            line: 7,
            message: "Review SDK db alias usage and migrate db.type builder calls to db.table.",
            excerpt: "const assertedSchema = db as const;",
          },
        ],
      }),
    ]);
  });
});
