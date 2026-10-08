import { describe, expect, test } from "vitest";
import { effectiveDateDefault } from "./date-default";

describe("effectiveDateDefault", () => {
  test("an unset defaultDateRepresentation keeps the legacy string representation", () => {
    expect(effectiveDateDefault({})).toBe("legacy");
    expect(effectiveDateDefault({ defaultDateRepresentation: undefined })).toBe("legacy");
  });

  test('"temporal" is passed through as the effective default', () => {
    expect(effectiveDateDefault({ defaultDateRepresentation: "temporal" })).toBe("temporal");
  });

  test('"date" is passed through as the effective default', () => {
    expect(effectiveDateDefault({ defaultDateRepresentation: "date" })).toBe("date");
  });
});
