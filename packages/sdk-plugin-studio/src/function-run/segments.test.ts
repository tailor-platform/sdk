import json from "@enlumine/json";
import { describe, expect, test } from "vitest";
import { segments } from "./segments";

describe("segments", () => {
  test("keeps plain text as a single plain segment", () => {
    expect(segments("a < b", null)).toEqual([{ kind: "plain", text: "a < b" }]);
  });

  test("splits JSON into segments whose texts join back to the source", () => {
    const source = '{"a": 1}';

    const result = segments(source, json);

    expect([result.map((segment) => segment.text).join(""), result.map((s) => s.kind)]).toEqual([
      source,
      ["punctuation", "string", "punctuation", "plain", "number", "punctuation"],
    ]);
  });

  test("returns nothing for an empty source", () => {
    expect(segments("", json)).toEqual([]);
  });
});
