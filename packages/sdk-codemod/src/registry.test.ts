import { describe, expect, test } from "vitest";
import { getApplicableCodemods } from "./registry";

describe("getApplicableCodemods", () => {
  test("returns codemods when upgrading across their version boundary", () => {
    const codemods = getApplicableCodemods("1.33.0", "2.0.0");
    expect(codemods.length).toBeGreaterThan(0);
    expect(codemods[0]!.id).toBe("v2/define-generators-to-plugins");
  });

  test("returns empty when both versions are before the codemod boundary", () => {
    expect(getApplicableCodemods("1.0.0", "1.5.0")).toEqual([]);
  });

  test("returns empty when both versions are after the codemod boundary", () => {
    expect(getApplicableCodemods("2.0.0", "3.0.0")).toEqual([]);
  });

  test("returns empty when from is already at the codemod boundary", () => {
    expect(getApplicableCodemods("2.0.0", "2.1.0")).toEqual([]);
  });

  test("throws for invalid semver versions", () => {
    expect(() => getApplicableCodemods("invalid", "2.0.0")).toThrow("Invalid fromVersion");
    expect(() => getApplicableCodemods("1.0.0", "invalid")).toThrow("Invalid toVersion");
  });

  test("apply-to-deploy scans source files with embedded CLI strings", () => {
    const applyToDeploy = getApplicableCodemods("1.67.1", "2.0.0").find(
      (codemod) => codemod.id === "v2/apply-to-deploy",
    );

    expect(applyToDeploy?.filePatterns).toEqual(
      expect.arrayContaining(["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"]),
    );
  });
});
