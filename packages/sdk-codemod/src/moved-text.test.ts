import { describe, expect, test } from "vitest";
import { movedIndex } from "./moved-text";

describe("movedIndex", () => {
  test("takes the first of the occurrences whose surroundings match the source's as far", () => {
    expect(movedIndex("(x)", 1, 1, "[x] [x]")).toBe(1);
  });
});
