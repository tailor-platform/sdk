import { describe, expect, test } from "vitest";
import { parseTailorErrors } from "./tailor-errors";

const rpc = (payload: unknown) =>
  `rpc error: code = Aborted desc = TailorErrors: ${JSON.stringify(payload)}\n    at file:///.tailor/test-run/add.entry.js:33:15\n    at <eval>:17:38`;

describe("parseTailorErrors", () => {
  test("reads the items a function run reports for a failed validation", () => {
    expect(
      parseTailorErrors(
        rpc({ errors: [{ message: "Expected an integer: received x", path: ["a"] }] }),
      ),
    ).toEqual([{ message: "Expected an integer: received x", path: ["a"] }]);
  });

  test("reads every item and keeps array indexes in the path as numbers", () => {
    const text = rpc({
      errors: [
        { message: "Required field is missing", path: ["b"] },
        { message: "Expected a string: received 5", path: ["items", 1, "name"] },
      ],
    });

    expect(parseTailorErrors(text)).toEqual([
      { message: "Required field is missing", path: ["b"] },
      { message: "Expected a string: received 5", path: ["items", 1, "name"] },
    ]);
  });

  test.each([
    ["an error that is not a TailorErrors", "rpc error: code = Unknown desc = boom"],
    ["a TailorErrors whose payload is not JSON", "desc = TailorErrors: not json\n    at x"],
    ["a payload without an errors list", `desc = ${"TailorErrors: " + JSON.stringify({ a: 1 })}`],
    ["undefined", undefined],
  ])("returns nothing for %s", (_name, text) => {
    expect(parseTailorErrors(text)).toEqual([]);
  });

  test("skips items that are not a message with a path", () => {
    const text = rpc({
      errors: [{ message: "ok", path: [] }, { message: 1, path: [] }, { path: ["a"] }, "x"],
    });

    expect(parseTailorErrors(text)).toEqual([{ message: "ok", path: [] }]);
  });
});
