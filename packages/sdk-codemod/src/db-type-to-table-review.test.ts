import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, describe, expect, test } from "vitest";
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
});
