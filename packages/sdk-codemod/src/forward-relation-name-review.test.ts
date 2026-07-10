import { describe, expect, test } from "vitest";
import transform, { reviewFindings } from "../codemods/v2/forward-relation-name/scripts/transform";

describe("forward relation name migration review", () => {
  test("flags non-self relations that omit toward.as", () => {
    const source = `
const post = db.table("Post", {
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: user },
  }),
});
`;

    expect(transform(source, "post.ts")).toBeNull();
    expect(reviewFindings(source, "post.ts", "post.ts")).toMatchObject([
      {
        file: "post.ts",
        line: 3,
        message: expect.stringContaining("toward.as"),
        excerpt: expect.stringContaining("relation"),
      },
    ]);
  });

  test("ignores relations whose forward name behavior is unchanged", () => {
    const source = `
const post = db.table("Post", {
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: user, as: "author" },
  }),
  parentId: db.uuid().relation({
    type: "n-1",
    toward: { type: "self" },
  }),
  ownerId: db.uuid().relation({
    type: "keyOnly",
    toward: { type: user },
  }),
});
`;

    expect(reviewFindings(source, "post.ts", "post.ts")).toEqual([]);
  });

  test("flags relation configs composed with spreads or shorthand properties", () => {
    const source = `
const primary = db.uuid().relation({
  ...relationConfig,
  toward: { type: user },
});
const secondary = db.uuid().relation({ type, toward });
`;

    const findings = reviewFindings(source, "post.ts", "post.ts");

    expect(findings).toHaveLength(2);
  });

  test("flags relation configs with computed properties", () => {
    const source = `
const author = db.uuid().relation({
  type: "n-1",
  [TOWARD]: { type: user },
});
`;

    const findings = reviewFindings(source, "post.ts", "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("flags relations whose toward.as value may use the default", () => {
    const source = `
const post = db.table("Post", {
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: user, as: "" },
  }),
  reviewerId: db.uuid().relation({
    type: "n-1",
    toward: { type: user, as: undefined },
  }),
  ownerId: db.uuid().relation({
    type: "n-1",
    toward: { type: user, as: relationName },
  }),
});
`;

    const findings = reviewFindings(source, "post.ts", "post.ts");

    expect(findings).toHaveLength(3);
  });

  test("flags relation calls that use computed member access", () => {
    const source = `
const authorId = db.uuid()["relation"]({
  type: "n-1",
  toward: { type: user },
});
`;

    const findings = reviewFindings(source, "post.ts", "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("flags multiline destructured relation builder aliases", () => {
    const source = `
const {
  relation: defineRelation,
}: ReturnType<typeof db.uuid> = db.uuid();
const authorId = defineRelation({
  type: "n-1",
  toward: { type: user },
});
`;

    const findings = reviewFindings(source, "post.ts", "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("parses TypeScript extensions as TypeScript when strings contain closing tags", () => {
    const source = `
const marker = "</div>";
const typed = <Foo>value;
const authorId = db.uuid().relation({
  type: "n-1",
  toward: { type: user },
});
`;

    const findings = reviewFindings(source, "post.ts", "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("ignores malformed and unrelated relation-like calls", () => {
    const source = `
client.relation({ toward: { type: user } });
const relation = { type: "n-1", toward: { type: user } };
`;

    expect(reviewFindings(source, "post.ts", "post.ts")).toEqual([]);
  });
});
