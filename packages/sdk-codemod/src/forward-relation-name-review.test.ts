import { describe, expect, test } from "vitest";
import transform, { reviewFindings } from "../codemods/v2/forward-relation-name/scripts/transform";

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

    expect(transform(source, "post.ts")).toBeNull();
    await expect(reviewFindings(source, "post.ts", "post.ts")).resolves.toMatchObject([
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
});
`;

    await expect(reviewFindings(source, "post.ts", "post.ts")).resolves.toEqual([]);
  });

  test("ignores malformed and unrelated relation-like calls", async () => {
    const source = `
client.relation({ toward: { type: user } });
const relation = { type: "n-1", toward: { type: user } };
`;

    await expect(reviewFindings(source, "post.ts", "post.ts")).resolves.toEqual([]);
  });
});
