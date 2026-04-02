import { describe, expect, it } from "vitest";
import { getApplicableCodemods } from "./codemod-registry";

describe("getApplicableCodemods", () => {
  it("returns codemods when upgrading across their version boundary", () => {
    const codemods = getApplicableCodemods("1.33.0", "2.0.0");
    expect(codemods.length).toBeGreaterThan(0);
    expect(codemods[0]!.id).toBe("v2/define-generators-to-plugins");
  });

  it("returns empty when from and to are both before the codemod boundary", () => {
    const codemods = getApplicableCodemods("1.0.0", "1.5.0");
    expect(codemods).toEqual([]);
  });

  it("returns empty when from and to are both after the codemod boundary", () => {
    const codemods = getApplicableCodemods("2.0.0", "3.0.0");
    expect(codemods).toEqual([]);
  });

  it("returns empty when from is already at the codemod boundary", () => {
    const codemods = getApplicableCodemods("2.0.0", "2.1.0");
    expect(codemods).toEqual([]);
  });

  it("throws for invalid semver versions", () => {
    expect(() => getApplicableCodemods("invalid", "2.0.0")).toThrow("Invalid fromVersion");
    expect(() => getApplicableCodemods("1.0.0", "invalid")).toThrow("Invalid toVersion");
  });
});
