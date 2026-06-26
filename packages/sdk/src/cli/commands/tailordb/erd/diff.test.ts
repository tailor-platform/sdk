import { describe, expect, test } from "vitest";
import {
  buildErdSchemaDiff,
  extractEmbeddedErdSchema,
  renderErdDiffHtml,
  renderErdDiffMarkdown,
} from "./diff";
import type { TailorDbErdSchema, TailorDbErdTable } from "./types";

function table(name: string, overrides: Partial<TailorDbErdTable> = {}): TailorDbErdTable {
  return {
    name,
    pluralForm: `${name.toLowerCase()}s`,
    columns: [
      {
        name: "id",
        type: "uuid",
        required: true,
        array: false,
        primaryKey: true,
        unique: true,
      },
    ],
    indexes: [],
    forwardRelationships: [],
    backwardRelationships: [],
    ...overrides,
  };
}

function schema(overrides: Partial<TailorDbErdSchema> = {}): TailorDbErdSchema {
  return {
    version: 1,
    namespace: "tailordb",
    generatedAt: "2026-01-01T00:00:00.000Z",
    revision: "base-revision",
    source: "local",
    cleanRoom: { implementation: "tailor-sdk", notes: [] },
    tables: [table("User")],
    relations: [],
    ...overrides,
  };
}

describe("extractEmbeddedErdSchema", () => {
  test("parses the viewer schema data block", () => {
    const embedded = schema({ namespace: "</script><img>" });
    const html = `<html><script type="application/json" id="erd-schema">${JSON.stringify(
      embedded,
    ).replaceAll("<", "\\u003c")}</script></html>`;

    expect(extractEmbeddedErdSchema(html)).toMatchObject({
      namespace: "</script><img>",
      revision: "base-revision",
    });
  });

  test("reports a missing schema data block", () => {
    expect(() => extractEmbeddedErdSchema("<html></html>")).toThrow("ERD schema block not found");
  });
});

describe("buildErdSchemaDiff", () => {
  test("ignores generation timestamp-only changes", () => {
    const diff = buildErdSchemaDiff({
      base: schema({ generatedAt: "2026-01-01T00:00:00.000Z" }),
      head: schema({ generatedAt: "2026-01-02T00:00:00.000Z" }),
    });

    expect(diff.changed).toBe(false);
    expect(diff.summary).toEqual({ added: 0, changed: 0, removed: 0 });
    expect(diff.changes).toEqual([]);
  });

  test("classifies table, column, index, and relation changes", () => {
    const base = schema({
      revision: "base-revision",
      tables: [
        table("Order"),
        table("User", {
          columns: [
            {
              name: "id",
              type: "uuid",
              required: true,
              array: false,
              primaryKey: true,
              unique: true,
            },
            {
              name: "name",
              type: "string",
              required: true,
              array: false,
            },
          ],
          indexes: [{ name: "idx_user_name", fields: ["name"], unique: false }],
        }),
      ],
      relations: [
        {
          name: "User.organizationId->Organization.id",
          sourceTable: "User",
          sourceColumns: ["organizationId"],
          targetTable: "Organization",
          targetColumns: ["id"],
          required: true,
          unique: false,
          kind: "foreignKey",
        },
      ],
    });
    const head = schema({
      revision: "head-revision",
      tables: [
        table("Invoice"),
        table("User", {
          columns: [
            {
              name: "id",
              type: "uuid",
              required: true,
              array: false,
              primaryKey: true,
              unique: true,
            },
            {
              name: "name",
              type: "text",
              required: true,
              array: false,
            },
            {
              name: "email",
              type: "string",
              required: false,
              array: false,
            },
          ],
          indexes: [{ name: "idx_user_name", fields: ["name"], unique: true }],
        }),
      ],
      relations: [
        {
          name: "User.organizationId->Organization.id",
          sourceTable: "User",
          sourceColumns: ["organizationId"],
          targetTable: "Organization",
          targetColumns: ["id"],
          required: false,
          unique: false,
          kind: "foreignKey",
        },
      ],
    });

    const diff = buildErdSchemaDiff({ base, head });

    expect(diff.changed).toBe(true);
    expect(diff.summary).toEqual({ added: 2, changed: 3, removed: 1 });
    expect(diff.changes).toEqual([
      {
        action: "removed",
        entity: "table",
        path: "Order",
        detail: "Table removed",
      },
      {
        action: "added",
        entity: "table",
        path: "Invoice",
        detail: "Table added",
      },
      {
        action: "changed",
        entity: "column",
        path: "User.name",
        detail: "Changed fields: type",
      },
      {
        action: "added",
        entity: "column",
        path: "User.email",
        detail: "Column added",
      },
      {
        action: "changed",
        entity: "index",
        path: "User.idx_user_name",
        detail: "Changed fields: unique",
      },
      {
        action: "changed",
        entity: "relation",
        path: "User.organizationId->Organization.id",
        detail: "Changed fields: required",
      },
    ]);
  });
});

describe("ERD diff rendering", () => {
  test("renders markdown and self-contained HTML summaries", () => {
    const diff = buildErdSchemaDiff({
      base: schema(),
      head: schema({
        revision: "head-revision",
        tables: [table("Account"), table("User")],
      }),
    });

    expect(renderErdDiffMarkdown(diff)).toContain("| tailordb | 1 | 0 | 0 |");

    const html = renderErdDiffHtml(diff);
    expect(html).toContain("<title>TailorDB ERD diff - tailordb</title>");
    expect(html).toContain("Account");
    expect(html).toContain('<script type="application/json" id="erd-diff">');
    expect(html).not.toContain("</script><img");
  });
});
