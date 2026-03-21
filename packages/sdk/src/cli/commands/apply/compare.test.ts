import { describe, expect, test } from "vitest";
import { collectDiffLines } from "./compare";

describe("collectDiffLines", () => {
  test("collects field-path diffs for nested objects", () => {
    expect(
      collectDiffLines(
        {
          cors: ["https://a.example.com"],
          nested: { enabled: false },
        },
        {
          cors: ["https://b.example.com"],
          nested: { enabled: true },
        },
      ),
    ).toEqual([
      'cors[0]: remote="https://a.example.com" local="https://b.example.com"',
      "nested.enabled: remote=false local=true",
    ]);
  });

  test("truncates diff output when the line limit is reached", () => {
    expect(collectDiffLines({ a: 1, b: 2, c: 3 }, { a: 4, b: 5, c: 6 }, 2)).toEqual([
      "a: remote=1 local=4",
      "b: remote=2 local=5",
      "...diff output truncated",
    ]);
  });

  test("collapses missing object subtrees to the parent path", () => {
    expect(
      collectDiffLines(
        {
          schema: {
            fields: {
              description: {
                type: "string",
                required: false,
              },
            },
          },
        },
        {
          schema: {
            fields: {},
          },
        },
      ),
    ).toEqual(["schema.fields.description: remote=present local=missing"]);
  });
});
