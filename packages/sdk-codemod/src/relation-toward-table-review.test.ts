import { describe, expect, test } from "vitest";
import transform, { reviewFindings } from "../codemods/v3/relation-toward-table/scripts/transform";

describe("relation toward.type -> toward.table migration review", () => {
  test("rewrites a literal toward.type and reports nothing left to review", () => {
    const source = `
const post = db.table("Post", {
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: user },
  }),
});
`;

    expect(transform(source, "post.ts")).toContain("toward: { table: user }");
    expect(reviewFindings(source, "post.ts", "post.ts")).toEqual([]);
  });

  test("flags relation configs composed with spreads", () => {
    const source = `
const primary = db.uuid().relation({
  ...relationConfig,
  toward: { type: user },
});
`;

    expect(transform(source, "post.ts")).toBeNull();
    const findings = reviewFindings(source, "post.ts", "post.ts");
    expect(findings).toHaveLength(1);
  });

  test("flags relation configs with computed toward keys", () => {
    const source = `
const author = db.uuid().relation({
  type: "n-1",
  [TOWARD]: { type: user },
});
`;

    expect(transform(source, "post.ts")).toBeNull();
    const findings = reviewFindings(source, "post.ts", "post.ts");
    expect(findings).toHaveLength(1);
  });

  test("flags a toward value that isn't a literal object", () => {
    const source = `
const shared = { type: user };
const authorId = db.uuid().relation({
  type: "n-1",
  toward: shared,
});
`;

    expect(transform(source, "post.ts")).toBeNull();
    const findings = reviewFindings(source, "post.ts", "post.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("toward isn't a literal object");
  });

  test("ignores malformed and unrelated relation-like calls", () => {
    const source = `
client.relation({ toward: { type: user } });
const relation = { type: "n-1", toward: { type: user } };
`;

    expect(transform(source, "post.ts")).toBeNull();
    expect(reviewFindings(source, "post.ts", "post.ts")).toEqual([]);
  });

  test("flags a toward that already has both table and type instead of producing a duplicate key", () => {
    const source = `
const order = db.table("Order", {
  customerId: db.uuid().relation({
    type: "n-1",
    toward: { table: preferred, type: legacy },
  }),
});
`;

    expect(transform(source, "order.ts")).toBeNull();
    const findings = reviewFindings(source, "order.ts", "order.ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("duplicate key");
  });

  test("does not touch the outer relation cardinality type", () => {
    const source = `
const field = { type: "uuid", relation: null };
const order = db.table("Order", {
  customerId: db.uuid().relation({
    type: "n-1",
    toward: { type: customer, as: "purchaser" },
  }),
});
`;

    const result = transform(source, "post.ts");
    expect(result).toContain('const field = { type: "uuid", relation: null };');
    expect(result).toContain('type: "n-1",');
    expect(result).toContain('toward: { table: customer, as: "purchaser" }');
  });
});
