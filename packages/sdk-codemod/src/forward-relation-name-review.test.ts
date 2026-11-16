import { describe, expect, test } from "vitest";
import { reviewThroughRunner } from "./test-helpers/codemods";

const review = (source: string, relativePath: string) =>
  reviewThroughRunner("v2/forward-relation-name", source, relativePath);

describe("forward relation name migration review", () => {
  test("flags non-self relations that omit toward.as", async () => {
    const source = `
const post = db.table("Post", {
  authorId: db.uuid().relation({
    type: "n-1",
    toward: { type: user },
  }),
});
`;

    const { transformed, findings } = await review(source, "post.ts");

    expect(transformed).toBeNull();
    expect(findings).toMatchObject([
      {
        file: "post.ts",
        line: 3,
        message: expect.stringContaining("toward.as"),
        excerpt: expect.stringContaining("relation"),
      },
    ]);
  });

  test("ignores relations whose forward name behavior is unchanged", async () => {
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
  previousId: db.uuid().relation({
    type: "n-1",
    toward: { type: "self", as: "" },
  }),
  nextId: db.uuid().relation({
    type: "n-1",
    toward: { type: "self", as: maybeName },
  }),
});
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toEqual([]);
  });

  test("flags relation configs composed with spreads or shorthand properties", async () => {
    const source = `
const primary = db.uuid().relation({
  ...relationConfig,
  toward: { type: user },
});
const secondary = db.uuid().relation({ type, toward });
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(2);
  });

  test("flags relations whose toward.as value may use the default", async () => {
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

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(3);
  });

  test("flags relation calls that use computed member access", async () => {
    const source = `
const authorId = db.uuid()["relation"]({
  type: "n-1",
  toward: { type: user },
});
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("flags relation calls that use dynamic computed member access", async () => {
    const source = `
const relationMethod = "relation";
const authorId = db.uuid()[relationMethod]({
  type: "n-1",
  toward: { type: user },
});
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("flags multiline destructured relation builder aliases", async () => {
    const source = `
const {
  relation: defineRelation,
}: ReturnType<typeof db.uuid> = db.uuid();
const authorId = defineRelation({
  type: "n-1",
  toward: { type: user },
});
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("flags relation builder aliases destructured in function parameters", async () => {
    const source = `
function apply({ relation }: ReturnType<typeof db.uuid>) {
  return relation({
    type: "n-1",
    toward: { type: user },
  });
}
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("parses TypeScript extensions as TypeScript when strings contain closing tags", async () => {
    const source = `
const marker = "</div>";
const typed = <Foo>value;
const authorId = db.uuid().relation({
  type: "n-1",
  toward: { type: user },
});
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toHaveLength(1);
  });

  test("parses JavaScript extensions as TSX when they contain JSX", async () => {
    const source = `const view = <Widget />; const authorId = db.uuid().relation({ type: "n-1", toward: { type: user } });`;

    const { findings } = await review(source, "post.js");

    expect(findings).toHaveLength(1);
  });

  test("ignores malformed and unrelated relation-like calls", async () => {
    const source = `
client.relation({ toward: { type: user } });
client["validate"]({ type: "n-1", toward: { type: user } });
const relation = { type: "n-1", toward: { type: user } };
`;

    const { findings } = await review(source, "post.ts");

    expect(findings).toEqual([]);
  });
});
