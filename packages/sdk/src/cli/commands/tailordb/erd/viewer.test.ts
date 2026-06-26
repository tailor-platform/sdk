import { describe, expect, test } from "vitest";
import { buildViewerHtml } from "./viewer";
import type { TailorDbErdSchema } from "./types";

function buildSchema(overrides: Partial<TailorDbErdSchema> = {}): TailorDbErdSchema {
  return {
    version: 1,
    namespace: "tailordb",
    generatedAt: "2026-01-01T00:00:00.000Z",
    revision: "test-revision",
    source: "local",
    cleanRoom: { implementation: "tailor", notes: [] },
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
    relations: [],
    ...overrides,
  };
}

// Extract and parse the embedded schema JSON the same way the viewer (and any
// external tooling such as a future ERD diff) would.
function extractEmbeddedSchema(html: string): unknown {
  const match = html.match(/<script type="application\/json" id="erd-schema">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("embedded schema block not found");
  return JSON.parse(match[1]!);
}

describe("buildViewerHtml", () => {
  test("inlines CSS/JS and embeds the schema as a parseable data block", () => {
    const html = buildViewerHtml({ schema: buildSchema() });

    expect(html).not.toContain('href="./styles.css"');
    expect(html).not.toContain('src="./app.js"');
    expect(html).toContain("<style>");
    expect(html).toContain('<script type="module">');
    expect(html).toContain('<script type="application/json" id="erd-schema">');
    // Embedded as JSON data, not an executable global assignment.
    expect(html).not.toContain("window.__ERD_SCHEMA__");
    expect(extractEmbeddedSchema(html)).toMatchObject({ namespace: "tailordb" });
    // Only the data block and the inlined module may close a <script> element;
    // any "</script" leaking from the inlined JS must be escaped.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  test("escapes < so embedded schema content cannot break out of the script tag", () => {
    const html = buildViewerHtml({
      schema: buildSchema({ namespace: "</script><img src=x>" }),
    });

    expect(html).not.toContain("</script><img src=x>");
    expect(html).toContain("\\u003c/script>\\u003cimg src=x>");
    // The escaped value round-trips back to the original via JSON.parse.
    expect(extractEmbeddedSchema(html)).toMatchObject({ namespace: "</script><img src=x>" });
  });

  test("preserves U+2028/U+2029 in embedded values via JSON round-trip", () => {
    const lineSep = String.fromCharCode(0x2028);
    const paraSep = String.fromCharCode(0x2029);
    const description = `line${lineSep}para${paraSep}end`;
    const html = buildViewerHtml({
      schema: buildSchema({
        tables: [
          {
            name: "User",
            pluralForm: "users",
            description,
            columns: [],
            indexes: [],
            forwardRelationships: [],
            backwardRelationships: [],
          },
        ],
      }),
    });

    const parsed = extractEmbeddedSchema(html) as TailorDbErdSchema;
    expect(parsed.tables[0]?.description).toBe(description);
  });
});
