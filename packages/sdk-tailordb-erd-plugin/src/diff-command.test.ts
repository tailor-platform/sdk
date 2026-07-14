import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeErdDiff } from "./diff-command";
import type { TailorDbErdSchema } from "./types";

let tempDir: string;

function schema(overrides: Partial<TailorDbErdSchema> = {}): TailorDbErdSchema {
  return {
    version: 1,
    namespace: "tailordb",
    generatedAt: "2026-01-01T00:00:00.000Z",
    revision: "revision",
    source: "local",
    cleanRoom: { implementation: "tailor", notes: [] },
    tables: [],
    relations: [],
    ...overrides,
  };
}

function htmlWithSchema(value: TailorDbErdSchema): string {
  return `<script type="application/json" id="erd-schema">${JSON.stringify(value)}</script>`;
}

describe("writeErdDiff", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-erd-diff-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("writes diff HTML and JSON files", () => {
    const baseHtml = path.join(tempDir, "base.html");
    const headHtml = path.join(tempDir, "head.html");
    const outputHtml = path.join(tempDir, "out", "diff.html");
    const outputJson = path.join(tempDir, "out", "diff.json");

    fs.writeFileSync(baseHtml, htmlWithSchema(schema()), "utf8");
    fs.writeFileSync(
      headHtml,
      htmlWithSchema(
        schema({
          revision: "head-revision",
          tables: [
            {
              name: "User",
              pluralForm: "users",
              columns: [],
              indexes: [],
              forwardRelationships: [],
              backwardRelationships: [],
            },
          ],
        }),
      ),
      "utf8",
    );

    const result = writeErdDiff({ baseHtml, headHtml, outputHtml, outputJson });

    const output = fs.readFileSync(outputHtml, "utf8");
    expect(output).toContain("TailorDB ERD diff - tailordb");
    expect(output).toContain('id="erd-schema"');
    expect(output).toContain('id="erd-current-schema"');
    expect(output).toContain('id="erd-diff"');
    expect(output).toContain("function renderNodes()");
    expect(JSON.parse(fs.readFileSync(outputJson, "utf8"))).toMatchObject({
      namespace: "tailordb",
      summary: { added: 1, changed: 0, removed: 0 },
    });
    expect(result.diff.changed).toBe(true);
  });

  test("uses an empty base when only head HTML is supplied", () => {
    const headHtml = path.join(tempDir, "head.html");
    const outputHtml = path.join(tempDir, "diff.html");

    fs.writeFileSync(
      headHtml,
      htmlWithSchema(
        schema({
          tables: [
            {
              name: "User",
              pluralForm: "users",
              columns: [],
              indexes: [],
              forwardRelationships: [],
              backwardRelationships: [],
            },
          ],
        }),
      ),
      "utf8",
    );

    const result = writeErdDiff({ headHtml, outputHtml });

    expect(result.diff.baseRevision).toBe("missing-base");
    expect(result.diff.summary).toEqual({ added: 1, changed: 0, removed: 0 });
  });
});
