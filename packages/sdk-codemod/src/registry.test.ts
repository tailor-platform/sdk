import { describe, expect, test } from "vitest";
import { allCodemods, getApplicableCodemods } from "./registry";

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

  test("flags CommonJS TypeScript files for runtime globals review", () => {
    const codemod = allCodemods.find((entry) => entry.id === "v2/runtime-globals-opt-in");

    expect(codemod?.filePatterns).toContain("**/*.{ts,tsx,mts,cts}");
    expect(codemod?.suspiciousPatterns).toContain("tailor.idp");
    expect(codemod?.prompt).toContain("@tailor-platform/sdk/runtime/globals");
  });
});
