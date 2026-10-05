import { describe, expect, test } from "vitest";
import { applyDateRepresentation } from "./date-representation";

const GATE = "__TAILOR_PLATFORM_BUNDLE_DATE_DEFAULT";

describe("applyDateRepresentation", () => {
  test("gives `t` date fields without `as` Temporal values until restored", () => {
    const previous = process.env[GATE];
    try {
      delete process.env[GATE];
      const restore = applyDateRepresentation("temporal");
      expect(process.env[GATE]).toBe("temporal");
      restore();
      expect(process.env[GATE]).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env[GATE];
      else process.env[GATE] = previous;
    }
  });
});
