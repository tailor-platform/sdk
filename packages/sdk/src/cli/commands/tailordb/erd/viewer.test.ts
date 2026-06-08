import { describe, expect, test } from "vitest";
import { buildStandaloneViewerHtml } from "./viewer";
import type { TailorDbErdSchema } from "./types";

function buildSchema(overrides: Partial<TailorDbErdSchema> = {}): TailorDbErdSchema {
  return {
    version: 1,
    namespace: "tailordb",
    generatedAt: "2026-01-01T00:00:00.000Z",
    revision: "test-revision",
    source: "local",
    cleanRoom: { implementation: "tailor-sdk", notes: [] },
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

describe("buildStandaloneViewerHtml", () => {
  test("inlines CSS/JS and embeds the schema without external asset links", () => {
    const html = buildStandaloneViewerHtml({ schema: buildSchema() });

    expect(html).not.toContain('href="./styles.css"');
    expect(html).not.toContain('src="./app.js"');
    expect(html).toContain("<style>");
    expect(html).toContain('<script type="module">');
    expect(html).toContain("window.__ERD_SCHEMA__");
    expect(html).toContain('"namespace":"tailordb"');
    // Only the embed script and the inlined module may close a <script> element;
    // any "</script" leaking from the inlined JS must be escaped.
    expect(html.match(/<\/script>/g)).toHaveLength(2);
  });

  test("escapes < so embedded schema content cannot break out of the script tag", () => {
    const html = buildStandaloneViewerHtml({
      schema: buildSchema({ namespace: "</script><img src=x>" }),
    });

    expect(html).not.toContain("</script><img src=x>");
    expect(html).toContain("\\u003c/script>\\u003cimg src=x>");
  });
});
