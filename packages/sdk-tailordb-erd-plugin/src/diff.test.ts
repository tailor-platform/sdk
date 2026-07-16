import { describe, expect, test } from "vitest";
import {
  buildErdSchemaDiff,
  buildErdDiffViewerSchema,
  createEmptyErdSchema,
  extractEmbeddedErdSchema,
  renderErdDiffHtml,
} from "./diff";
import { buildViewerHtml } from "./viewer";
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
    cleanRoom: { implementation: "tailor", notes: [] },
    tables: [table("User")],
    relations: [],
    ...overrides,
  };
}

function extractJsonBlock<T>(html: string, id: string): T {
  const pattern = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);
  const match = pattern.exec(html);
  if (!match?.[1]) {
    throw new Error(`JSON block not found: ${id}`);
  }
  return JSON.parse(match[1]) as T;
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

  test("preserves dollar replacement patterns in embedded schema values", () => {
    const description = "Prices use $$, literal match $&, left context $`, right context $'.";
    const html = buildViewerHtml({
      schema: schema({
        tables: [table("Invoice", { description })],
      }),
    });

    expect(extractEmbeddedErdSchema(html).tables[0]?.description).toBe(description);
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

  test("represents a missing base namespace as added tables", () => {
    const diff = buildErdSchemaDiff({
      base: createEmptyErdSchema({ namespace: "tailordb", revision: "missing-base" }),
      head: schema({ tables: [table("Account"), table("User")] }),
    });

    expect(diff.summary).toEqual({ added: 2, changed: 0, removed: 0 });
    expect(diff.changes.map((change) => change.path)).toEqual(["Account", "User"]);
  });

  test("detects relationship metadata changes on tables", () => {
    const base = schema({
      tables: [
        table("User", {
          forwardRelationships: [
            {
              name: "orders",
              targetType: "Order",
              targetField: "userId",
              sourceField: "id",
              isArray: true,
              description: "Old label",
            },
          ],
        }),
      ],
    });
    const head = schema({
      tables: [
        table("User", {
          forwardRelationships: [
            {
              name: "orders",
              targetType: "Order",
              targetField: "userId",
              sourceField: "id",
              isArray: true,
              description: "New label",
            },
          ],
        }),
      ],
    });

    const diff = buildErdSchemaDiff({ base, head });

    expect(diff.changed).toBe(true);
    expect(diff.changes).toContainEqual({
      action: "changed",
      entity: "table",
      path: "User",
      detail: "Changed fields: forwardRelationships",
    });
  });
});

describe("ERD diff rendering", () => {
  test("keeps removed tables and columns visible for diff highlighting", () => {
    const base = schema({
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
              name: "legacyCode",
              type: "string",
              required: false,
              array: false,
            },
          ],
        }),
      ],
    });
    const head = schema({
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
          ],
        }),
      ],
    });

    const viewerSchema = buildErdDiffViewerSchema({ base, head });

    expect(viewerSchema.tables.map((item) => item.name).toSorted()).toEqual([
      "Invoice",
      "Order",
      "User",
    ]);
    expect(viewerSchema.tables.find((item) => item.name === "User")?.columns).toContainEqual(
      expect.objectContaining({ name: "legacyCode" }),
    );
  });

  test("renders the existing ERD viewer with embedded diff metadata", () => {
    const head = schema({
      revision: "head-revision",
      tables: [table("Account"), table("User")],
    });
    const diff = buildErdSchemaDiff({
      base: schema(),
      head,
    });
    const viewerSchema = buildErdDiffViewerSchema({
      base: schema(),
      head,
    });
    const html = renderErdDiffHtml({ schema: viewerSchema, currentSchema: head, diff });
    expect(html).toContain("<title>TailorDB ERD diff - tailordb</title>");
    expect(html).toContain('id="erd-schema"');
    expect(html).toContain('id="erd-current-schema"');
    expect(html).toContain('<script type="application/json" id="erd-diff">');
    expect(html).toContain('id="view-mode-control"');
    expect(
      extractJsonBlock<TailorDbErdSchema>(html, "erd-current-schema").tables.map(
        (item) => item.name,
      ),
    ).toEqual(["Account", "User"]);
    expect(html).toContain("function renderNodes()");
    expect(html).not.toContain("<table>");
    expect(html).not.toContain("</script><img");
  });
});
