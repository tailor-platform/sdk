import { describe, expect, test } from "vitest";
import { pickPluginArrays } from "./guards";

describe("pickPluginArrays", () => {
  const first = { id: "first", description: "First plugin" };
  const second = { id: "second", description: "Second plugin", pluginConfig: { on: true } };

  test("returns each exported array whose items are all plugin-shaped", () => {
    expect(pickPluginArrays({ default: {}, plugins: [first], more: [second] })).toEqual([
      [first],
      [second],
    ]);
  });

  test("leaves an array alone as a whole when any item is not plugin-shaped", () => {
    expect(
      pickPluginArrays({
        mixed: [first, null],
        strings: [first, "not a plugin"],
        noDescription: [{ id: "third" }],
        empty: [],
        notAnArray: first,
      }),
    ).toEqual([]);
  });
});
