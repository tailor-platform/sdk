import { describe, expect, test } from "vitest";
import transform from "../codemods/v3/relation-toward-table/scripts/transform";
import { reviewThroughRunner } from "./test-helpers/codemods";

const review = (source: string, relativePath: string) =>
  reviewThroughRunner("v3/relation-toward-table", source, relativePath);

describe("relation toward.type -> toward.table migration review", () => {
  test("rewrites a literal toward.type and reports nothing left to review", async () => {
    const source = `
const post = db.table("Post", {
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: user },
  }),
});
`;

    const { transformed, findings } = await review(source, "post.ts");

    expect(transformed).toContain("toward: { table: user }");
    expect(findings).toEqual([]);
  });

  test("flags relation configs composed with spreads", async () => {
    const source = `
const primary = db.uuid().relation({
  ...relationConfig,
  toward: { type: user },
});
`;

    const { transformed, findings } = await review(source, "post.ts");

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
  });

  test("flags relation configs with computed toward keys", async () => {
    const source = `
const author = db.uuid().relation({
  type: "n-1",
  [TOWARD]: { type: user },
});
`;

    const { transformed, findings } = await review(source, "post.ts");

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
  });

  test("flags a toward value that isn't a literal object", async () => {
    const source = `
const shared = { type: user };
const authorId = db.uuid().relation({
  type: "n-1",
  toward: shared,
});
`;

    const { transformed, findings } = await review(source, "post.ts");

    expect(transformed).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain("toward isn't a literal object");
  });

  test("ignores malformed and unrelated relation-like calls", async () => {
    const source = `
client.relation({ toward: { type: user } });
const relation = { type: "n-1", toward: { type: user } };
`;

    const { transformed, findings } = await review(source, "post.ts");

    expect(transformed).toBeNull();
    expect(findings).toEqual([]);
  });

  test("flags a toward that already has both table and type instead of producing a duplicate key", async () => {
    const source = `
const order = db.table("Order", {
  customerId: db.uuid().relation({
    type: "n-1",
    toward: { table: preferred, type: legacy },
  }),
});
`;

    const { transformed, findings } = await review(source, "order.ts");

    expect(transformed).toBeNull();
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
