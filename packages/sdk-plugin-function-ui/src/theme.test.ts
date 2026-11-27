import { describe, expect, test } from "vitest";
import { scopeTheme } from "./theme";

describe("scopeTheme", () => {
  test("puts the scope in front of every .enlumine selector", () => {
    expect(scopeTheme(".enlumine{--a:1}.enlumine .enl-x{color:var(--a)}", ".dark")).toBe(
      ".dark .enlumine{--a:1}.dark .enlumine .enl-x{color:var(--a)}",
    );
  });
});
